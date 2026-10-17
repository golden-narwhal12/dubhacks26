import { z } from 'zod';
import { BindingSchema, ComponentSchema, EndpointSchema, FileSchema, Id, PlacementSchema, ProjectSchema, WireSchema, endpointKey, type Project, type Endpoint } from './schema';
import { partById } from '../parts/catalog';

export class DomainError extends Error { constructor(public code:string,message:string){super(message);} }
export function terminal(project:Project,e:Endpoint){const c=project.components.find(c=>c.id===e.componentId);if(!c)throw new DomainError('REFERENCE',`Component ${e.componentId} does not exist`); const t=partById(c.partId).terminals.find(t=>t.id===e.terminalId);if(!t)throw new DomainError('TERMINAL',`Unknown terminal ${endpointKey(e)}`);return t;}
const unique=(values:string[],what:string)=>{if(new Set(values).size!==values.length)throw new DomainError('DUPLICATE',`Duplicate ${what}`);};
export function validateProject(input:unknown):Project {
 const p=ProjectSchema.parse(input);
 unique(p.components.map(c=>c.id),'component ID');unique(p.components.map(c=>c.ref),'reference name');unique(p.wires.map(w=>w.id),'wire ID');unique(p.files.map(f=>f.id),'file ID');unique(p.files.map(f=>f.path),'file path');unique(p.bindings.map(b=>b.id),'binding ID');
 for(const c of p.components){const part=partById(c.partId);if(part.version!==c.partVersion)throw new DomainError('VERSION','Unsupported part version');}
 const pairs:string[]=[];
 for(const w of p.wires){terminal(p,w.from);terminal(p,w.to);if(endpointKey(w.from)===endpointKey(w.to))throw new DomainError('SELF_CONNECTION','A terminal cannot connect to itself');pairs.push([endpointKey(w.from),endpointKey(w.to)].sort().join('|'));}
 unique(pairs,'connection');
 for(const view of ['wiring','schematic'] as const){for(const id of Object.keys(p.layouts[view]))if(!p.components.some(c=>c.id===id))throw new DomainError('LAYOUT_REFERENCE',`Unknown layout component ${id}`);for(const c of p.components)if(!p.layouts[view][c.id])throw new DomainError('LAYOUT_MISSING',`Missing ${view} placement for ${c.id}`);}
 for(const b of p.bindings){const t=terminal(p,{componentId:b.boardId,terminalId:b.terminalId});if(t.kind!=='gpio')throw new DomainError('BINDING','Firmware bindings require a GPIO');terminal(p,b.target);if(!p.files.some(f=>f.id===b.fileId))throw new DomainError('REFERENCE','Missing binding file');}
 if(p.targetBoardId&&!p.components.some(c=>c.id===p.targetBoardId&&partById(c.partId).kind==='board'))throw new DomainError('TARGET','Invalid target board');
 return p;
}
export const CommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('addComponent'),component:ComponentSchema,placement:PlacementSchema}).strict(),
 z.object({type:z.literal('removeComponent'),id:Id}).strict(),
 z.object({type:z.literal('configureComponent'),id:Id,ref:z.string().min(1).max(48).optional(),label:z.string().max(80).optional()}).strict(),
 z.object({type:z.literal('moveComponent'),id:Id,view:z.enum(['wiring','schematic']),placement:PlacementSchema}).strict(),
 z.object({type:z.literal('connect'),wire:WireSchema}).strict(),
 z.object({type:z.literal('disconnect'),id:Id}).strict(),
 z.object({type:z.literal('writeFile'),file:FileSchema}).strict(),
 z.object({type:z.literal('setBinding'),binding:BindingSchema}).strict(),
 z.object({type:z.literal('removeBinding'),id:Id}).strict(),
 z.object({type:z.literal('setTarget'),id:Id.nullable()}).strict(),
 z.object({type:z.literal('renameProject'),name:z.string().min(1).max(100)}).strict(),
]);
export type Command=z.infer<typeof CommandSchema>;
export const TransactionSchema=z.object({expectedRevision:z.number().int().nonnegative(),summary:z.string().min(1).max(240),commands:z.array(CommandSchema).min(1).max(100)}).strict();
export type Transaction=z.infer<typeof TransactionSchema>;
export function transact(project:Project,input:unknown):Project {
 const tx=TransactionSchema.parse(input);if(tx.expectedRevision!==project.revision)throw new DomainError('STALE_REVISION',`Project changed: expected r${tx.expectedRevision}, now r${project.revision}. Inspect again before applying.`);
 const p=structuredClone(project);
 const exists=(id:string)=>{if(!p.components.some(c=>c.id===id))throw new DomainError('REFERENCE',`Unknown component ${id}`);};
 for(const c of tx.commands){switch(c.type){
 case 'addComponent':p.components.push(c.component);p.layouts.wiring[c.component.id]=c.placement;p.layouts.schematic[c.component.id]={...c.placement};break;
 case 'removeComponent':exists(c.id);p.components=p.components.filter(x=>x.id!==c.id);p.wires=p.wires.filter(w=>w.from.componentId!==c.id&&w.to.componentId!==c.id);p.bindings=p.bindings.filter(b=>b.boardId!==c.id&&b.target.componentId!==c.id);delete p.layouts.wiring[c.id];delete p.layouts.schematic[c.id];if(p.targetBoardId===c.id)p.targetBoardId=null;break;
 case 'configureComponent':{exists(c.id);const obj=p.components.find(x=>x.id===c.id)!;if(c.ref!==undefined)obj.ref=c.ref;if(c.label!==undefined)obj.config.label=c.label;break;}
 case 'moveComponent':exists(c.id);p.layouts[c.view][c.id]=c.placement;break;
 case 'connect':p.wires.push(c.wire);break;
 case 'disconnect':if(!p.wires.some(w=>w.id===c.id))throw new DomainError('REFERENCE','Unknown connection');p.wires=p.wires.filter(w=>w.id!==c.id);break;
 case 'writeFile':{const i=p.files.findIndex(f=>f.id===c.file.id);if(i<0)p.files.push(c.file);else p.files[i]=c.file;break;}
 case 'setBinding':p.bindings=p.bindings.filter(b=>b.id!==c.binding.id);p.bindings.push(c.binding);break;
 case 'removeBinding':p.bindings=p.bindings.filter(b=>b.id!==c.id);break;
 case 'setTarget':p.targetBoardId=c.id;break;
 case 'renameProject':p.name=c.name;break;
 }}
 p.revision=project.revision+1;return validateProject(p);
}
export const serializeProject=(p:Project)=>JSON.stringify(validateProject(p),null,2)+'\n';
export function parseProject(text:string){if(text.length>4000000)throw new DomainError('SIZE','Project exceeds 4 MB');return validateProject(JSON.parse(text));}
export interface History {past:{project:Project;summary:string}[];future:{project:Project;summary:string}[]}
export const emptyHistory=():History=>({past:[],future:[]});
export function record(history:History,old:Project,summary:string):History {return {past:[...history.past,{project:old,summary}].slice(-100),future:[]};}
export function travel(project:Project,history:History,direction:'undo'|'redo'){
 const source=direction==='undo'?history.past:history.future;const entry=source.at(-1);if(!entry)return {project,history};
 const restored=validateProject({...structuredClone(entry.project),revision:project.revision+1});
 const current={project,summary:entry.summary};
 return {project:restored,history:direction==='undo'?{past:history.past.slice(0,-1),future:[...history.future,current]}:{past:[...history.past,current],future:history.future.slice(0,-1)}};
}
