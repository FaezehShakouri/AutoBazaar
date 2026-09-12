// A transparent reference policy, not a model. Replace this function with your
// own strategy or call any model you choose from the agent's own computer.
export async function decide({self,products,suppliers,day,weather}){
  const prices={},load={},orders=[];let available=Math.max(0,self.cash-8000);
  const supplier=suppliers.find(s=>s.id==='wholesale');
  for(const p of products){
    prices[p.id]=Math.round(p.retail*(weather==='Hot'&&p.category==='drink'?1.15:1.05));
    load[p.id]=Math.min(30-self.inventory[p.id],self.storage[p.id]);
    const held=self.inventory[p.id]+self.storage[p.id]+self.orders.filter(o=>o.product===p.id).reduce((n,o)=>n+o.quantity,0);
    if(held<16){const quantity=32-held,cost=Math.round(p.cost*supplier.multiplier*(quantity>=24?.92:1))*quantity;if(cost<=available){orders.push({product:p.id,supplier:supplier.id,quantity});available-=cost;}}
  }
  return {prices,load,orders,rationale:'Keep a cash reserve, replenish low stock, and price drinks for the weather.',memory:`Day ${day}: cash ${self.cash}; ${orders.length} new orders. This is the example steady policy.`};
}
