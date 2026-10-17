import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {validateProject,parseProject,serializeProject} from '../src/domain/project';
import {listConnections,setConnection,keyFor} from './credentials';
import {callProvider,ProviderSchema,ModelSchema} from './providers';
import {z} from 'zod';

let win:BrowserWindow;
const tasks=new Map<string,AbortController>();
app.setName('Trace');
if(process.env.TRACE_TEST)app.setPath('userData',join(app.getPath('temp'),`trace-test-${process.pid}`));
function handle(channel:string,fn:(arg:any)=>unknown){ipcMain.handle(channel,(event,arg)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Untrusted IPC sender');return fn(arg);});}
app.whenReady().then(()=>{
 win=new BrowserWindow({width:1540,height:980,minWidth:960,minHeight:640,title:'Trace',backgroundColor:'#141719',titleBarStyle:'hiddenInset',trafficLightPosition:{x:16,y:17},webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/(docs\.arduino\.cc|www\.kingbrightusa\.com|www\.vishay\.com|documentation\.espressif\.com|docs\.espressif\.com)\//.test(url))void shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',e=>e.preventDefault());
 handle('project:save',async input=>{const p=validateProject(input);const d=await dialog.showSaveDialog(win,{defaultPath:`${p.name.replace(/[^a-zA-Z0-9-]/g,'-')}.trace.json`,filters:[{name:'Trace project',extensions:['trace.json']}]});if(d.canceled||!d.filePath)return {cancelled:true};await writeFile(d.filePath,serializeProject(p),'utf8');return {cancelled:false,name:d.filePath.split('/').at(-1)};});
 handle('project:open',async()=>{const d=await dialog.showOpenDialog(win,{filters:[{name:'Trace project',extensions:['json']}],properties:['openFile']});if(d.canceled)return {cancelled:true};const raw=await readFile(d.filePaths[0],'utf8');return {cancelled:false,project:parseProject(raw),name:d.filePaths[0].split('/').at(-1)};});
 handle('connections:list',()=>listConnections());
 handle('connections:set',input=>setConnection(input));
 handle('connections:test',async input=>{const a=z.object({provider:ProviderSchema,model:ModelSchema}).strict().parse(input);const c=new AbortController();await callProvider({...a,system:'Reply briefly.',messages:[{role:'user',text:'Reply OK.'}],maxTokens:32,requestId:crypto.randomUUID()},await keyFor(a.provider),c.signal,()=>{});return {ok:true,message:'Connection verified with a real API request. Small provider usage incurred.'};});
 handle('provider:turn',async input=>{if(tasks.size>=2)throw new Error('Task concurrency limit reached');const controller=new AbortController();const id=z.string().uuid().parse(input?.requestId);tasks.set(id,controller);try{return await callProvider(input,await keyFor(ProviderSchema.parse(input?.provider)),controller.signal,text=>win.webContents.send('provider:text',{requestId:id,text}));}finally{tasks.delete(id);}});
 handle('task:cancel',id=>{const key=z.string().uuid().parse(id);tasks.get(key)?.abort();});
 handle('capabilities',()=>({desktop:true,arduino:false,simavr:false}));
 if(process.env.TRACE_DEV_URL)void win.loadURL(process.env.TRACE_DEV_URL);else void win.loadFile(join(__dirname,'../dist/index.html'));
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(win&&!win.isDestroyed())win.show();});
