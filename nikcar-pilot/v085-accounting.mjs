// NikCar v0.85 — deterministic accounting rules (not yet wired into live billing).
// Immutable daily accrual IDs; discounts affect new rent only, never opening debts.

export function dayNumber(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error("Invalid ISO day");
 const timestamp=Date.parse(value+"T00:00:00Z");
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==value)throw Error("Invalid calendar day");
 return Math.floor(timestamp/86400000);
}

export function toCents(value){
 const s=String(value).trim(); if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(s))throw Error("Invalid amount");
 const parts=s.split("."),x=Number(parts[0])*100+Number((parts[1]||"").padEnd(2,"0"));
 if(!Number.isSafeInteger(x))throw Error("Amount out of range");return x;
}

export function dailyRentPosting({rentalId,driverId,carId,day,dailyRate,approvedDaysOff=[],postedEntries=[]}){
 if(!rentalId||!carId||!driverId)throw Error("Missing rental identity");
 const d=dayNumber(day),sourceKey=`rent:${rentalId}:${day}`;
 if(postedEntries.some(x=>x.sourceKey===sourceKey))return null;
 const free=approvedDaysOff.filter(x=>x.status==="approved"&&x.driver_id===driverId&&x.vehicle_id===carId&&dayNumber(x.date_from)<=d&&dayNumber(x.date_to)>=d);
 if(free.length>1)throw Error("Overlapping approved free days");
 const grossCents=toCents(dailyRate),discountCents=free.length?grossCents:0;
 return {sourceKey,rentalId,driverId,carId,day,grossCents,discountCents,chargeCents:grossCents-discountCents,dayOffId:free[0]?.id||null};
}

export function confirmedPaymentEntry({id,status,amount}){
 if(status!=="confirmed")return null;
 if(!id)throw Error("Payment id required");
 return {sourceKey:`payment:${id}`,amountCents:-toCents(amount)};
}

export function rentalBalance({openingDebtCents=0,entries=[]}){
 if(!Number.isSafeInteger(openingDebtCents)||openingDebtCents<0)throw Error("Invalid opening debt");
 const seen=new Set(); let netCents=0;
 for(const entry of entries){
  if(typeof entry.sourceKey!=="string"||!entry.sourceKey||!Number.isSafeInteger(entry.amountCents))throw Error("Invalid ledger entry");
  if(seen.has(entry.sourceKey))throw Error("Duplicate ledger entry");
  seen.add(entry.sourceKey);netCents+=entry.amountCents;
 }
 if(!Number.isSafeInteger(netCents+openingDebtCents))throw Error("Ledger overflow");
 return {openingDebtCents,netCents,balanceCents:openingDebtCents+netCents};
}
