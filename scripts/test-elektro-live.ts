import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { sourceSchema, profileSchema } from "../shared/types.js";
import { acquire } from "../server/acquisition.js";
import { Engine } from "../server/engine.js";
const store = new Store(path.resolve("data/elektro-live-verification"));
store.put("settings", "main", {...store.settings(), downloadTimeoutSeconds: 300, maxDownloadMb: 300});
for (const [n, target] of [[2,"2026-09-28T04:00:00Z"],[3,"2026-09-10T04:30:00Z"]] as const) {
  const source = sourceSchema.parse({id:`electro${n}`,name:`Electro-L N${n}`,satellite:`Electro-L N${n}`,region:"",enabled:true, product:"elektro-l", transport:"ftp",location:`ftp://ntsomz.gptl.ru:2121/ELECTRO_L_${n}/`,username:"electro",password:"electro",pattern:"\\d{6}_\\d{4}\\.zip$",timestampRegex:"(\\d{6}_\\d{4})",timestampFormat:"elektro",cadenceMinutes:30,longitude:n===2?-14.5:76,expectedWidth:2784,expectedHeight:2784,crop:[.012703,.012703,.012703,.012703],invert:true,brightness:n===2?1.2:1.3,attribution:"NTSOMZ MSU-GS channel 9",cleanConfirmed:true});
  console.log("TEST", source.name, target);
  const img = await acquire(store, source, new Date(target), 1, AbortSignal.timeout(900000), console.log);
  store.put("sources",source.id,{...source,validation:{at:new Date().toISOString(),compatible:true,message:"live test",imageId:img.id}});
  store.put("profiles",source.id,profileSchema.parse({id:source.id,name:source.name,enabled:false,sourceIds:[source.id],projection:"map",underlay:"world.200412.3x21600x10800.jpg"}));
  const engine = new Engine(store,process.cwd());
  const job=engine.enqueue(source.id,new Date(target));
  while(engine.active) await new Promise(r=>setTimeout(r,1000));
  const result = store.get<{status:string;message:string}>("jobs",job.id)!;
  console.log(result);
  assert.equal(result.status,"succeeded",result.message);
}
store.db.close();
