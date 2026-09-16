import { Store } from './store.mjs';
export function hostStore(root:string):Store;
export function browserConfig(root:string):any;
export function isDedicatedBrowserBot(root:string,botId:string):boolean;
export function parseBrowserRequest(text:string,options?:{requestId?:string|undefined;human?:boolean|undefined}):any;
export function enqueueBrowserJob(root:string,raw:any):any;
export function enqueueBrowserCommand(root:string,botId:string,raw:any):any;
export function deliveryIdentity(root:string,from:string,to:string,text:string):any;
export function acceptDelivery(root:string,identity:any):void;
