import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { opText,type OpLabel } from "../operations/copy";
import { Pager } from "../operations/ui";
import { allowed,type MvpUser } from "../finance/FinancePage";
import { DirectOrderForm } from "./DirectOrderForm";
import { Detail,ProcurementPage } from "./ProcurementPage";
export function MvpOrdersPage({locale,user}:{locale:Locale;user:MvpUser}){
 const[detailKind,setDetailKind]=useState<import("@shared/procurement").ProcurementKind>("orders"); const[search,setSearch]=useState(""),[page,setPage]=useState(1),[create,setCreate]=useState(false),[detail,setDetail]=useState<number|null>(null),[advanced,setAdvanced]=useState(false);const list=trpc.procurement.list.useQuery({kind:"orders",search,page,pageSize:20});
 if(advanced)return <div className="op-page"><button onClick={()=>setAdvanced(false)}>{opText(locale,"orders")}</button><ProcurementPage locale={locale} user={user}/></div>;
 return <div className="op-page"><h2>{opText(locale,"directOrder")}</h2><div className="op-toolbar"><input value={search} aria-label={opText(locale,"search")} placeholder={opText(locale,"search")} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>{allowed(user,"orders.create")&&<button onClick={()=>setCreate(true)}>{opText(locale,"create")}</button>}<button onClick={()=>setAdvanced(true)}>{opText(locale,"advancedSourcing")}</button></div>{list.isError?<p role="alert">{opText(locale,"error")}</p>:list.isLoading?<p>{opText(locale,"loading")}</p>:<div className="op-table"><table><thead><tr><th>{opText(locale,"code")}</th><th>{opText(locale,"status")}</th></tr></thead><tbody>{list.data?.records.map(r=><tr key={r.id}><td><button onClick={()=>{setDetailKind("orders");setDetail(r.id);}}>{r.number}</button></td><td>{opText(locale,r.status as OpLabel)}</td></tr>)}</tbody></table>{!list.data?.records.length&&<p>{opText(locale,"empty")}</p>}</div>}<Pager page={page} total={list.data?.total??0} setPage={setPage} locale={locale}/>{create&&<DirectOrderForm locale={locale} onClose={()=>setCreate(false)}/>} {detail!==null&&<Detail kind={detailKind} id={detail} locale={locale} user={user} onClose={()=>setDetail(null)} onOpen={(kind,id)=>{setDetailKind(kind);setDetail(id);}}/>}</div>;
}

