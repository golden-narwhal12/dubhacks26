import {create} from 'zustand';
import type {Project,View,Endpoint} from '../domain/schema';
import {emptyHistory,record,travel,transact,parseProject,serializeProject,type History,type Command,type Transaction} from '../domain/project';
import {exampleProject,blankProject} from '../domain/example';
import {validateCircuit,type Diagnostic} from '../domain/validation';
import type {RunResult,ProviderId,Connection} from '../services/bridge';
export type Selection={kind:'component';id:string}|{kind:'terminal';id:string;endpoint:Endpoint}|{kind:'wire';id:string}|{kind:'diagnostic';id:string;objectIds:string[]}|null;
export interface Message {id:string;role:'user'|'assistant'|'activity';text:string;objectIds?:string[];details?:string}
export interface Proposal {transaction:Transaction;origin:'agent'|'rule'}
interface State {
 project:Project;history:History;selection:Selection;view:View;activeFileId:string;diagnostics:Diagnostic[];
 library:boolean;settings:boolean;outputOpen:boolean;outputTab:'diagnostics'|'build'|'simulation';notice:string|null;
 result:RunResult|null;building:boolean;buildRequestId:string|null;capabilities:{desktop:boolean;arduino:boolean;simavr:boolean};
 messages:Message[];agentBusy:boolean;agentStatus:string;connections:Connection[];provider:ProviderId;model:string;proposal:Proposal|null;
 participation:'request'|'suggest'|'proactive';policy:'preview'|'apply';requests:number;toolCalls:number;tokens:number;changes:{revision:number;summary:string;origin:string}[];
 apply:(summary:string,commands:Command[],expectedRevision?:number,origin?:'human'|'agent'|'rule')=>boolean;
 undo:()=>void;redo:()=>void;select:(selection:Selection)=>void;replaceProject:(p:Project,summary:string)=>void;
 reset:(blank?:boolean)=>void;save:()=>Promise<void>;open:()=>Promise<void>;run:(simulate?:boolean)=>Promise<void>;cancelBuild:()=>void;dismissNotice:()=>void;
}
function load():Project{try{const text=localStorage.getItem('trace.draft.v1');if(text)return parseProject(text);}catch{}return exampleProject();}
const initial=load();
let lastEditTime=0;
export const useWorkspace=create<State>((set,get)=>({
 project:initial,history:emptyHistory(),selection:null,view:'wiring',activeFileId:initial.files[0].id,diagnostics:validateCircuit(initial),library:false,settings:false,outputOpen:false,outputTab:'diagnostics',notice:null,result:null,building:false,buildRequestId:null,capabilities:{desktop:!!window.trace,arduino:false,simavr:false},
 messages:[],agentBusy:false,agentStatus:'',connections:[],provider:'gemini',model:'gemini-2.5-flash',proposal:null,participation:'suggest',policy:'preview',requests:0,toolCalls:0,tokens:0,changes:[],
 apply:(summary,commands,expectedRevision,origin='human')=>{const s=get();try{const project=transact(s.project,{expectedRevision:expectedRevision??s.project.revision,summary,commands});
  const now=Date.now();const typing=commands.length===1&&commands[0].type==='writeFile'&&origin==='human';const coalesce=typing&&now-lastEditTime<900&&s.history.past.at(-1)?.summary===summary;
  set({project,history:coalesce?s.history:record(s.history,s.project,summary),diagnostics:validateCircuit(project),changes:[...s.changes,{revision:project.revision,summary,origin}].slice(-30),notice:null});lastEditTime=typing?now:0;return true;
 }catch(e){set({notice:e instanceof Error?e.message:'Change rejected'});return false;}},
 undo:()=>{const s=get(),v=travel(s.project,s.history,'undo');set({...v,diagnostics:validateCircuit(v.project),selection:null,proposal:null,changes:[...s.changes,{revision:v.project.revision,summary:'Undo',origin:'human'}].slice(-30)});lastEditTime=0;},
 redo:()=>{const s=get(),v=travel(s.project,s.history,'redo');set({...v,diagnostics:validateCircuit(v.project),selection:null,proposal:null,changes:[...s.changes,{revision:v.project.revision,summary:'Redo',origin:'human'}].slice(-30)});lastEditTime=0;},
 select:selection=>set({selection}),
 replaceProject:(p,summary)=>{const s=get();const project={...p,revision:s.project.revision+1};set({project,history:record(s.history,s.project,summary),diagnostics:validateCircuit(project),selection:null,proposal:null,activeFileId:project.files[0].id,result:null,changes:[{revision:project.revision,summary,origin:'human'}]});},
 reset:blank=>get().replaceProject(blank?blankProject():exampleProject(),blank?'New blank project':'Reset indicator example'),
 save:async()=>{try{if(window.trace){const r=await window.trace.saveProject(get().project);if(!r.cancelled)set({notice:`Saved ${r.name}`});}else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([serializeProject(get().project)],{type:'application/json'}));a.download='project.trace.json';a.click();URL.revokeObjectURL(a.href);}}catch(e){set({notice:`Save failed: ${String(e)}`});}},
 open:async()=>{try{if(window.trace){const r=await window.trace.openProject();if(r.project)get().replaceProject(r.project,'Open project');}else{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const f=input.files?.[0];if(f)get().replaceProject(parseProject(await f.text()),'Open project');}catch(e){set({notice:`Cannot open project: ${String(e)}`});}};input.click();}}catch(e){set({notice:`Cannot open project: ${String(e)}`});}},
 run:async(simulate=false)=>{const s=get();if(s.building)return;if(!window.trace){set({notice:'Compile and execution require the desktop application.'});return;}const requestId=crypto.randomUUID();set({building:true,buildRequestId:requestId,outputOpen:true,outputTab:simulate?'simulation':'build'});try{const result=await window.trace.build({project:s.project,requestId,simulate});set({result});}catch(e){set({result:{revision:s.project.revision,kind:simulate?'simulation':'build',success:false,output:String(e),durationMs:0}});}finally{set({building:false,buildRequestId:null});}},
 cancelBuild:()=>{const id=get().buildRequestId;if(id)void window.trace?.cancel(id);},dismissNotice:()=>set({notice:null}),
}));
useWorkspace.subscribe(s=>{try{localStorage.setItem('trace.draft.v1',serializeProject(s.project));}catch{}});
if(window.trace){void window.trace.capabilities().then(capabilities=>useWorkspace.setState({capabilities}));void window.trace.connections().then(connections=>useWorkspace.setState({connections}));}
export const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,8)}`;
export const selectedIds=(s:Selection)=>!s?[]:s.kind==='diagnostic'?s.objectIds:s.kind==='terminal'?[s.endpoint.componentId,s.id]:[s.id];
