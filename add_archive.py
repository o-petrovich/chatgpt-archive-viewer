#!/usr/bin/env python3
from pathlib import Path
import argparse, json, zipfile, shutil, re
from datetime import datetime

ROOT=Path(__file__).resolve().parent
CHATS=ROOT/"chats"
CATALOG=ROOT/"catalog.json"

def slug(s):
    s=re.sub(r'[\\/:*?"<>|]+',"-",s or "Без-назви")
    s=re.sub(r"\s+","-",s.strip())
    return s[:90].strip("-") or "Без-назви"

def load_json(p):
    with open(p,"r",encoding="utf-8") as f:return json.load(f)

def first_message_time(conv):
    times=[]
    for node in (conv.get("mapping") or {}).values():
        msg=(node or {}).get("message")
        if not msg:continue
        ts=msg.get("create_time")
        if isinstance(ts,(int,float)) and ts>0:times.append(ts)
    ts=min(times) if times else conv.get("create_time")
    return float(ts) if isinstance(ts,(int,float)) else 0.0

def conv_date(conv):
    ts=first_message_time(conv)
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else datetime.now().strftime("%Y-%m-%d")

def prefix_from_conversations(path):
    name=Path(path).name
    if name=="conversations.json":return ""
    suffix="_conversations.json"
    if not name.endswith(suffix):raise ValueError("Файл не має суфікса _conversations.json")
    return name[:-len(suffix)]

def find_set_from_conversations(conversations_file):
    conversations_file=Path(conversations_file).resolve();folder=conversations_file.parent;prefix=prefix_from_conversations(conversations_file)
    if prefix:
        idx=folder/f"{prefix}_attachments-index.json";manifest=folder/f"{prefix}_run-manifest.json";volumes=sorted(folder.glob(f"{prefix}_attachments-vol*.zip"))
    else:
        idx=folder/"attachments-index.json";manifest=folder/"run-manifest.json";volumes=sorted(folder.glob("attachments-vol*.zip"))
    return {"conversations":conversations_file,"attachments_index":idx,"manifest":manifest,"volumes":volumes,"prefix":prefix}

def validate_set(fs):
    missing=[]
    if not fs["conversations"].is_file():missing.append(fs["conversations"].name)
    if not fs["attachments_index"].is_file():missing.append(fs["attachments_index"].name)
    return missing

def load_catalog():
    try:
        d=load_json(CATALOG);return d if isinstance(d,list) else []
    except Exception:return []

def save_catalog(catalog):
    catalog.sort(key=lambda x:(x.get("first_message_time",0),x.get("title","")),reverse=True)
    with open(CATALOG,"w",encoding="utf-8") as f:json.dump(catalog,f,ensure_ascii=False,indent=2)

def attachment_belongs(info,conv_id):
    if not isinstance(info,dict):return False
    candidates=(info.get("convId"),info.get("conversation_id"),info.get("conversationId"))
    return str(conv_id) in {str(x) for x in candidates if x is not None}

def resolve_extracted(tmp,rel):
    if not rel:return None
    rel_path=Path(rel)
    direct=tmp/rel_path
    if direct.is_file():return direct
    # Some helper ZIPs wrap files in one extra directory or index path differs by prefix.
    matches=list(tmp.rglob(rel_path.name))
    if len(matches)==1:return matches[0]
    rel_norm=str(rel_path).replace("\\","/")
    for p in matches:
        if str(p.relative_to(tmp)).replace("\\","/").endswith(rel_norm):return p
    return None

def import_conversations_file(conversations_file):
    fs=find_set_from_conversations(conversations_file);missing=validate_set(fs)
    if missing:raise RuntimeError("Не вистачає файлів: "+", ".join(missing))
    data=load_json(fs["conversations"]);conversations=data.get("conversations") if isinstance(data,dict) else data
    if not isinstance(conversations,list):raise RuntimeError("Неочікуваний формат conversations.json")
    index=load_json(fs["attachments_index"]);all_atts=index.get("attachments",{}) or {}
    tmp=ROOT/".import_tmp"
    if tmp.exists():shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    try:
        for zp in fs["volumes"]:
            with zipfile.ZipFile(zp,"r") as zf:zf.extractall(tmp)
        CHATS.mkdir(parents=True,exist_ok=True);catalog=load_catalog();added=[]
        for conv in conversations:
            conv_id=conv.get("conversation_id") or conv.get("id") or slug(conv.get("title"));title=conv.get("title") or "Без назви";date=conv_date(conv);first_ts=first_message_time(conv)
            folder_name=f"{date}_{slug(title)}";dest=CHATS/folder_name
            if dest.exists() and (dest/"conversation.json").exists():
                try:
                    old=load_json(dest/"conversation.json");old_id=old.get("conversation_id") if isinstance(old,dict) else None
                except Exception:old_id=None
                if old_id and old_id!=conv_id:
                    folder_name+=f"_{str(conv_id)[:8]}";dest=CHATS/folder_name
            dest.mkdir(parents=True,exist_ok=True)
            with open(dest/"conversation.json","w",encoding="utf-8") as f:json.dump(conv,f,ensure_ascii=False,indent=2)
            subset={}
            for pointer,info in all_atts.items():
                if not attachment_belongs(info,conv_id):continue
                subset[pointer]=info;rel=info.get("path")
                if rel:
                    src=resolve_extracted(tmp,rel);dst=dest/rel
                    if src:
                        dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
            with open(dest/"attachments-index.json","w",encoding="utf-8") as f:json.dump({"attachments":subset},f,ensure_ascii=False,indent=2)
            topics=dest/"topics.json"
            if not topics.exists():
                with open(topics,"w",encoding="utf-8") as f:json.dump([{"title":"Огляд чату","start_message_id":None}],f,ensure_ascii=False,indent=2)
            entry={"id":conv_id,"title":title,"date":date,"first_message_time":first_ts,"path":f"chats/{folder_name}"}
            catalog=[x for x in catalog if x.get("id")!=conv_id];catalog.append(entry);added.append(entry)
        save_catalog(catalog);return {"added":added,"file_set":fs}
    finally:shutil.rmtree(tmp,ignore_errors=True)

def delete_source_set(fs):
    paths=[fs["conversations"],fs["attachments_index"]]
    if fs["manifest"].is_file():paths.append(fs["manifest"])
    paths.extend(fs["volumes"]);deleted=[]
    for p in paths:
        if p.exists():p.unlink();deleted.append(str(p))
    return deleted

def main():
    p=argparse.ArgumentParser();p.add_argument("conversations_file");p.add_argument("--delete-source",action="store_true");a=p.parse_args()
    result=import_conversations_file(a.conversations_file);print(f"Додано чатів: {len(result['added'])}")
    if a.delete_source:print(f"Видалено source-файлів: {len(delete_source_set(result['file_set']))}")

if __name__=="__main__":main()
