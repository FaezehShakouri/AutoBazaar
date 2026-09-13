// Deterministic house policies use only the same observation given to contenders.
export function demoHouseDecision({self,products,suppliers,day,weather},style='value'){
  if(!['value','premium','adaptive'].includes(style))throw Error('Unknown house strategy.');
  const prices={},load={},orders=[];
  const factor=style==='value'?.91:style==='premium'?1.24:weather==='Hot'?1.12:1.02;
  const reserve=style==='premium'?12000:8000;
  let available=Math.max(0,self.cash-reserve);
  const supplier=suppliers.find(s=>s.id===(style==='premium'?'express':'wholesale'))||suppliers[0];
  for(const p of products){
    const weatherFactor=weather==='Hot'&&p.category==='drink'?1.08:1;
    prices[p.id]=Math.round(p.retail*factor*weatherFactor);
    load[p.id]=Math.max(0,Math.min(30-self.inventory[p.id],self.storage[p.id]));
    const held=self.inventory[p.id]+self.storage[p.id]+self.orders.filter(o=>o.product===p.id).reduce((n,o)=>n+o.quantity,0);
    const target=style==='value'?42:style==='premium'?25:34;
    if(held<18){
      const quantity=target-held,cost=Math.floor((p.cost*Math.round(supplier.multiplier*100)*(quantity>=24?92:100)+5000)/10000)*quantity;
      if(cost<=available){orders.push({product:p.id,supplier:supplier.id,quantity});available-=cost;}
    }
  }
  return {prices,load,orders,rationale:style==='value'?'House value strategy: lower prices and bulk replenishment.':style==='premium'?'House premium strategy: higher margins, faster delivery and a larger cash reserve.':'House adaptive strategy: adjust prices to weather and maintain balanced stock.',memory:`Demo house policy ${style}; day ${day}; cash ${self.cash}.`};
}
