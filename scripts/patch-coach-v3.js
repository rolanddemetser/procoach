const fs=require('fs');
const path=require('path');
const file=path.join(process.cwd(),'index.html');
let html=fs.readFileSync(file,'utf8');
function replaceExact(oldText,newText,label){if(!html.includes(oldText))throw new Error(label+' not found');html=html.replace(oldText,newText)}
replaceExact('<title>ProCoach V33 Coach v2</title>','<title>ProCoach V34 Coach V3</title>','title');
replaceExact('ProCoach V33 🧠','ProCoach V34 🧠','heading');
const oldCoach=/function coach\(e=currentForm\(\)\)\{[\s\S]*?\n\}/;
if(!oldCoach.test(html))throw new Error('coach function not found');
html=html.replace(oldCoach,`const WEEK_PLAN={
  1:[{kind:'nordic',label:'Nordic Walking',min:50,max:70}],
  2:[{kind:'strength',label:'HASfit full body',min:30,max:30},{kind:'walk',label:'Wandelen',min:30,max:40}],
  3:[{kind:'yin',label:'Yin yoga',min:30,max:40},{kind:'walk',label:'Wandelen',min:45,max:60}],
  4:[{kind:'nordic',label:'Nordic Walking',min:50,max:70}],
  5:[{kind:'nordic',label:'Nordic Walking',min:60,max:60}],
  6:[{kind:'strength',label:'HASfit full body',min:30,max:30},{kind:'walk',label:'Wandelen',min:30,max:40}],
  0:[{kind:'measure',label:'Buikomtrek meten',min:0,max:0},{kind:'nordic_long',label:'Nordic Walking',min:75,max:90},{kind:'restorative',label:'Restorative yoga',min:30,max:30}]
};
function planForDate(date){const d=new Date((date||today)+'T12:00:00');return(WEEK_PLAN[d.getDay()]||[]).map(x=>Object.assign({},x))}
function formatDurationItem(a){if(a.kind==='measure')return a.label;return a.label+' '+a.min+(a.max!==a.min?'–'+a.max:'')+' min'}
function formatPlan(plan){return plan.map(formatDurationItem).join(' + ')}
function dayLoad(day){if(!day)return 0;const steps=num(day.steps)||0,walk=num(day.walkMin)||0,strength=num(day.strengthMin)||0,yoga=num(day.yogaMin)||0;return Math.round(clamp(steps/12000*30+walk/90*35+strength/40*30+yoga/60*5,0,100))}
function recentLoad(date,count){const vals=[];for(let i=1;i<=count;i++){const d=getActivityDay(addDays(date,-i));if(d)vals.push(dayLoad(d))}return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0}
function adaptPlan(plan){return plan.map(a=>{if(a.kind==='strength')return'HASfit uitstellen; vervang door mobiliteit 10–15 min';if(a.kind==='nordic_long')return'Nordic Walking inkorten naar 45–60 min rustig';if(a.kind==='nordic')return'Nordic Walking inkorten naar 30–45 min rustig';if(a.kind==='walk')return'Wandelen rustig '+Math.min(a.min,20)+'–'+Math.min(a.max,30)+' min';if(a.kind==='yin'||a.kind==='restorative')return formatDurationItem(a)+' behouden';return formatDurationItem(a)+' behouden'})}
function coach(e=currentForm()){
  e=deriveYesterday(e);
  const plan=planForDate(e.date),reasons=[];
  const sleep=num(e.sleepHours),bb=num(e.bodyBattery),bbMorning=e.bodyBatteryMorning===true||e.bodyBatterySource==='manual'||e.bodyBatterySource==='intervals',rhr=num(e.rhr),stepsY=num(e.yesterdaySteps),walkY=num(e.yesterdayWalkMin)||0,activityY=num(e.yesterdayActivityMin)||0,stress=normalizeStress(e.stressFeeling),feeling=e.feeling||'ok';
  const load3=recentLoad(e.date,3),load7=recentLoad(e.date,7);
  const heavyYesterday=(stepsY!==null&&stepsY>=12000)||walkY>=60||activityY>=75;
  const signals=[];
  if(feeling==='moe')signals.push('moe');
  if(stress==='hoog'||stress==='zeer_hoog')signals.push('stress');
  if(heavyYesterday)signals.push('gisteren');
  if(load3>=65)signals.push('belasting3');
  if(load7>=60)signals.push('belasting7');
  if(bb!==null&&bb<35&&bbMorning)signals.push('bodyBattery');
  if(isRhrElevated(rhr,e.date))signals.push('rusthartslag');
  if(sleep!==null&&sleep<5)signals.push('zeerKorteSlaap');
  else if(sleep!==null&&sleep<6&&signals.length)signals.push('korteSlaap');
  let mode='go',title='GO — VOLG DE WEEKPLANNING';
  let actions=['Vandaag: '+formatPlan(plan),'Start rustig en evalueer na 10 minuten','Behoud de geplande volgorde en intensiteit'];
  let dont=['Niet maximaliseren','Niet compenseren','Geen extra belasting bij pijn'];
  if(feeling==='ziek'){mode='stop';reasons.push('Ziek gevoel: herstel is vandaag de training.')}
  else if(feeling==='pijn'){mode='stop';reasons.push('Pijn gemeld: veiligheid gaat voor.')}
  else if(bb!==null&&bb<20&&bbMorning&&signals.length>=3){mode='stop';reasons.push('Zeer lage Body Battery samen met meerdere rode herstelsignalen.')}
  else if(signals.length>=2||signals.includes('zeerKorteSlaap')){mode='recover';title='AANGEPAST — WEEKPLANNING LICHTER';actions=adaptPlan(plan).slice(0,3);dont=['Geen zware kracht','Geen versnellingen','Geen extra lange wandeling']}
  if(sleep!==null&&sleep<5)reasons.push('Minder dan 5 uur slaap: zware onderdelen worden beperkt, niet alles geschrapt.');
  else if(sleep!==null&&sleep<6&&signals.includes('korteSlaap'))reasons.push('Korter dan 6 uur slaap telt alleen mee door een bijkomend herstelsignaal.');
  if(feeling==='moe')reasons.push('Je voelt je moe.');
  if(stress==='hoog'||stress==='zeer_hoog')reasons.push('Stress is verhoogd.');
  if(heavyYesterday)reasons.push('Gisteren was belastend.');
  if(load3>=65)reasons.push('De gemiddelde belasting over 3 dagen is hoog ('+load3+'/100).');else if(load7>=60)reasons.push('De gemiddelde belasting over 7 dagen is verhoogd ('+load7+'/100).');
  if(bb!==null&&bb<35&&bbMorning)reasons.push('Body Battery bij opstaan is laag.');
  if(isRhrElevated(rhr,e.date))reasons.push('Rusthartslag ligt boven je recente baseline.');
  if(mode==='stop'){title='STOP — HERSTEL EERST';actions=['Rust: herstel is de training','Alleen zeer rustig bewegen als dat goed voelt','Zoek medische hulp bij alarmsymptomen'];dont=['Geen kracht','Geen Nordic Walking','Geen lange wandeling']}
  if(!reasons.length)reasons.push('Herstel is voldoende; de volledige weekplanning blijft behouden.');
  return{mode,title,actions,dont,reasons:reasons.slice(0,4),ctx:{sleep,bb,bbMorning,rhr,stepsY,walkY,activityY,stress,feeling,load3,load7,plan},y:getActivityDay(addDays(e.date,-1))||{}};
}`);
fs.writeFileSync(file,html);console.log('Coach V3 patch applied');