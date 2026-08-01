const assert=require('assert');
const num=v=>v===undefined||v===null||v===''?null:Number(v);
function collectStepTotals(o,prefix,candidates,depth){if(!o||typeof o!=='object'||depth>4)return;if(Array.isArray(o)){o.slice(0,100).forEach((v,i)=>collectStepTotals(v,prefix+'['+i+']',candidates,depth+1));return}Object.keys(o).forEach(k=>{const v=o[k],path=prefix?prefix+'.'+k:k,low=k.toLowerCase().replace(/[^a-z]/g,'');const ok=['steps','stepcount','totalsteps','dailysteps'].includes(low);if(ok){const n=num(v);if(n!==null&&n>=0&&n<100000)candidates.push({path,value:n,priority:low==='totalsteps'||low==='dailysteps'?3:1})}if(v&&typeof v==='object')collectStepTotals(v,path,candidates,depth+1)})}
function extractStepInfo(a){const candidates=[];[['steps',a.steps],['totalSteps',a.totalSteps]].forEach(([path,raw])=>{const v=num(raw);if(v!==null)candidates.push({path,value:v,priority:path==='totalSteps'?3:2})});if(Array.isArray(a.stepCandidates))a.stepCandidates.forEach((item,i)=>{const v=num(item&&typeof item==='object'?item.value:item);if(v!==null)candidates.push({path:(item&&item.path)||'stepCandidates['+i+']',value:v,priority:4})});collectStepTotals(a,'',candidates,0);candidates.sort((a,b)=>b.value-a.value||b.priority-a.priority);return candidates[0]||{value:null}}
function collectBodyBatteryValues(o,prefix,candidates,depth){if(!o||typeof o!=='object'||depth>5)return;if(Array.isArray(o)){o.slice(0,200).forEach((v,i)=>collectBodyBatteryValues(v,prefix+'['+i+']',candidates,depth+1));return}Object.keys(o).forEach(k=>{const v=o[k],path=prefix?prefix+'.'+k:k,low=k.toLowerCase().replace(/[^a-z]/g,'');if(low.includes('bodybattery')){const n=num(v);if(n!==null&&n>=0&&n<=100)candidates.push({path,value:n,priority:low.includes('morning')||low.includes('max')?4:2});if(Array.isArray(v))v.forEach((item,i)=>{const n2=num(item&&typeof item==='object'?(item.value??item.bodyBattery??item.body_battery):item);if(n2!==null&&n2>=0&&n2<=100)candidates.push({path:path+'['+i+']',value:n2,priority:3})})}if(v&&typeof v==='object')collectBodyBatteryValues(v,path,candidates,depth+1)})}
function extractMorningBodyBattery(a){const candidates=[];[['body_battery_morning',a.body_battery_morning],['bodyBattery',a.bodyBattery]].forEach(([path,raw])=>{const v=num(raw);if(v!==null)candidates.push({path,value:v,priority:path.includes('morning')?5:2})});collectBodyBatteryValues(a,'',candidates,0);candidates.sort((a,b)=>b.value-a.value||b.priority-a.priority);return candidates[0]||{value:null}}
const WEEK_PLAN={1:['Nordic 50-70'],2:['HASfit 30','Wandelen 30-40'],3:['Yin 30-40','Wandelen 45-60'],4:['Nordic 50-70'],5:['Nordic 60'],6:['HASfit 30','Wandelen 30-40'],0:['Buikomtrek','Nordic 75-90','Restorative 30']};
function plan(date){return WEEK_PLAN[new Date(date+'T12:00:00').getDay()]}
function decision({sleep=7,feeling='ok',stress='normaal',heavy=false,bb=59,load3=20,load7=20}){const signals=[];if(feeling==='moe')signals.push('moe');if(stress==='hoog'||stress==='zeer_hoog')signals.push('stress');if(heavy)signals.push('heavy');if(load3>=65)signals.push('load3');if(load7>=60)signals.push('load7');if(bb<35)signals.push('bb');if(sleep<5)signals.push('short');else if(sleep<6&&signals.length)signals.push('sleep');if(feeling==='ziek'||feeling==='pijn')return'stop';if(bb<20&&signals.length>=3)return'stop';if(signals.length>=2||signals.includes('short'))return'recover';return'go'}
assert.strictEqual(extractStepInfo({steps:1718,stepCandidates:[{path:'wellness.steps',value:9071}]}).value,9071,'daily total must beat partial activity steps');
assert.strictEqual(extractStepInfo({steps:9071,totalSteps:9000}).value,9071);
assert.strictEqual(extractMorningBodyBattery({bodyBattery:55,bodyBatteryValues:[55,57,59,56]}).value,59,'highest morning candidate must win');
assert.strictEqual(extractMorningBodyBattery({body_battery_morning:59,bodyBattery:55}).value,59);
assert.deepStrictEqual(plan('2026-11-02'),['Nordic 50-70']);
assert.deepStrictEqual(plan('2026-11-03'),['HASfit 30','Wandelen 30-40']);
assert.deepStrictEqual(plan('2026-11-04'),['Yin 30-40','Wandelen 45-60']);
assert.deepStrictEqual(plan('2026-11-08'),['Buikomtrek','Nordic 75-90','Restorative 30']);
assert.strictEqual(decision({sleep:5.5}), 'go','short sleep alone must not downgrade');
assert.strictEqual(decision({sleep:4.5}), 'recover','under 5 hours adapts but does not stop');
assert.strictEqual(decision({sleep:5.5,stress:'hoog'}), 'recover');
assert.strictEqual(decision({sleep:7,heavy:true,load3:70}), 'recover');
assert.strictEqual(decision({feeling:'ziek'}), 'stop');
assert.strictEqual(decision({feeling:'pijn'}), 'stop');
assert.strictEqual(decision({sleep:7,bb:59}), 'go');
console.log('15 Coach V3 regression tests passed.');