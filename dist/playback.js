// Visual time is separate from market time. Each receipt is emitted exactly
// once per playback; pausing or replaying cannot create a simulated sale.
export class DayPlayback {
  constructor(){this.reset();}
  reset(){this.receipts=[];this.time=0;this.cursor=0;this.duration=0;this.active=false;}
  load(receipts){this.reset();this.receipts=receipts.map(r=>({...r}));this.duration=receipts.length?8+(receipts.length-1)*.48:5;this.active=true;}
  purchaseTime(index){return 4+index*.48;}
  advance(seconds){
    if(!this.active)return [];
    this.time=Math.min(this.duration,this.time+Math.max(0,seconds));
    const events=[];
    while(this.cursor<this.receipts.length&&this.purchaseTime(this.cursor)<=this.time)events.push(this.receipts[this.cursor++]);
    if(this.time>=this.duration)this.active=false;
    return events;
  }
  get progress(){return this.duration?this.time/this.duration:0;}
}
