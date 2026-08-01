const fs=require('fs');
const path=require('path');
const file=path.join(process.cwd(),'index.html');
let html=fs.readFileSync(file,'utf8');
function replaceExact(oldText,newText,label){if(!html.includes(oldText))throw new Error(label+' not found');html=html.replace(oldText,newText)}

replaceExact('<div><label>Body Battery bij opstaan</label><input id="bb" type="text" inputmode="numeric" placeholder="auto indien beschikbaar"></div>','<div><label>Body Battery bij opstaan</label><input id="bb" type="text" inputmode="numeric" placeholder="alleen manueel indien nodig"><div id="bbSourceLabel" class="small" style="margin-top:5px">Nog geen automatische waarde.</div></div>','Body Battery input');
replaceExact("function emptyDay(date){return{date,steps:null,stepsSource:'',stepCandidates:[],walkMin:0,activityMin:0,strengthMin:0,yogaMin:0,sleepHours:null,rhr:null,bodyBattery:null,bodyBatteryMorning:false,source:'intervals',syncedAt:new Date().toISOString()}}","function emptyDay(date){return{date,steps:null,stepsSource:'',stepCandidates:[],walkMin:0,activityMin:0,strengthMin:0,yogaMin:0,sleepHours:null,rhr:null,bodyBattery:null,bodyBatteryMorning:false,bodyBatterySourcePath:'',source:'intervals',syncedAt:new Date().toISOString()}}",'emptyDay');

const oldStep=/function extractStepInfo\(a\)\{[\s\S]*?\n\}/;
if(!oldStep.test(html))throw new Error('extractStepInfo not found');
html=html.replace(oldStep,`function extractStepInfo(a){
  const paths=['wellness.steps','wellness.Steps','wellness.stepCount','wellness.totalSteps','wellness.total_steps','totalSteps','total_steps','dailySteps','daily_steps','stepCount','step_count','Steps','steps'];
  const candidates=[];
  paths.forEach(path=>{const v=num(valueAt(a,path));if(v!==null&&v>=0&&v<100000)candidates.push({path,value:v,priority:path.includes('wellness')||path.toLowerCase().includes('total')||path.toLowerCase().includes('daily')?3:2})});
  ['stepCandidates','debugStepCandidates','wellness.stepCandidates'].forEach(path=>{const list=valueAt(a,path);if(Array.isArray(list))list.forEach((item,i)=>{const v=num(item&&typeof item==='object'?item.value:item);if(v!==null&&v>=0&&v<100000)candidates.push({path:(item&&item.path)||path+'['+i+']',value:v,priority:4})})});
  collectStepTotals(a,'',candidates,0);
  if(!candidates.length)return{value:null,source:'',candidates:[]};
  const unique=[...new Map(candidates.map(c=>[c.path+'|'+c.value,c])).values()];
  unique.sort((a,b)=>b.value-a.value||b.priority-a.priority);
  const best=unique[0];return{value:best.value,source:best.path,candidates:unique};
}
function collectStepTotals(o,prefix,candidates,depth){
  if(!o||typeof o!=='object'||depth>4)return;
  if(Array.isArray(o)){o.slice(0,100).forEach((v,i)=>collectStepTotals(v,prefix+'['+i+']',candidates,depth+1));return}
  Object.keys(o).forEach(k=>{const v=o[k],path=prefix?prefix+'.'+k:k,low=k.toLowerCase().replace(/[^a-z]/g,'');const ok=['steps','stepcount','totalsteps','dailysteps'].includes(low);if(ok){const n=num(v);if(n!==null&&n>=0&&n<100000)candidates.push({path,value:n,priority:low==='totalsteps'||low==='dailysteps'?3:1})}if(v&&typeof v==='object')collectStepTotals(v,path,candidates,depth+1)})
}`);

const oldBB=`    const bbMorning=num(getNested(a,['body_battery_morning','morning_body_battery','wellness.body_battery_morning']));
    const bb=bbMorning??num(getNested(a,['body_battery','bodyBattery','wellness.body_battery','wellness.bodyBattery','garmin.body_battery']));
    if(bb!==null){
      const day=ensureDay(by,activityDate||sleepDate);
      if(day){day.bodyBattery=bb;day.bodyBatteryMorning=bbMorning!==null}
    }`;
const newBB=`    const bbInfo=extractMorningBodyBattery(a);
    if(bbInfo.value!==null){
      const day=ensureDay(by,activityDate||sleepDate);
      if(day&&(num(day.bodyBattery)===null||bbInfo.value>day.bodyBattery)){day.bodyBattery=bbInfo.value;day.bodyBatteryMorning=true;day.bodyBatterySourcePath=bbInfo.path}
    }`;
replaceExact(oldBB,newBB,'Body Battery classify block');
replaceExact('function activityDataDate(a){',`function extractMorningBodyBattery(a){
  const candidates=[];
  ['body_battery_morning','morning_body_battery','bodyBatteryMorning','wellness.body_battery_morning','wellness.morning_body_battery'].forEach(path=>{const v=num(valueAt(a,path));if(v!==null&&v>=0&&v<=100)candidates.push({path,value:v,priority:5})});
  ['body_battery','bodyBattery','wellness.body_battery','wellness.bodyBattery','garmin.body_battery'].forEach(path=>{const v=num(valueAt(a,path));if(v!==null&&v>=0&&v<=100)candidates.push({path,value:v,priority:2})});
  collectBodyBatteryValues(a,'',candidates,0);
  if(!candidates.length)return{value:null,path:'',priority:0};
  const unique=[...new Map(candidates.map(c=>[c.path+'|'+c.value,c])).values()];unique.sort((a,b)=>b.value-a.value||b.priority-a.priority);return unique[0]
}
function collectBodyBatteryValues(o,prefix,candidates,depth){
  if(!o||typeof o!=='object'||depth>5)return;
  if(Array.isArray(o)){o.slice(0,200).forEach((v,i)=>collectBodyBatteryValues(v,prefix+'['+i+']',candidates,depth+1));return}
  Object.keys(o).forEach(k=>{const v=o[k],path=prefix?prefix+'.'+k:k,low=k.toLowerCase().replace(/[^a-z]/g,'');if(low.includes('bodybattery')){const n=num(v);if(n!==null&&n>=0&&n<=100)candidates.push({path,value:n,priority:low.includes('morning')||low.includes('max')?4:2});if(Array.isArray(v))v.forEach((item,i)=>{const n2=num(item&&typeof item==='object'?(item.value??item.bodyBattery??item.body_battery):item);if(n2!==null&&n2>=0&&n2<=100)candidates.push({path:path+'['+i+']',value:n2,priority:3})})}if(v&&typeof v==='object')collectBodyBatteryValues(v,path,candidates,depth+1)})
}
function activityDataDate(a){`,'Body Battery helpers');
replaceExact("if(num(e.bodyBattery)===null||e.bodyBatterySource!=='manual'){const v=num(todayActivity.bodyBattery);if(v!==null){e.bodyBattery=v;e.bodyBatteryMorning=todayActivity.bodyBatteryMorning===true;e.bodyBatterySource='intervals'}}","if(num(e.bodyBattery)===null||e.bodyBatterySource!=='manual'){const v=num(todayActivity.bodyBattery);if(v!==null){e.bodyBattery=v;e.bodyBatteryMorning=true;e.bodyBatterySource='intervals';e.bodyBatterySourcePath=todayActivity.bodyBatterySourcePath||'Intervals wellness'}}",'auto recovery Body Battery');
replaceExact("  $('bb').value=num(hydrated.bodyBattery)!==null?hydrated.bodyBattery:'';\n  $('feeling').value=hydrated.feeling||'ok';","  $('bb').value=num(hydrated.bodyBattery)!==null?hydrated.bodyBattery:'';\n  renderBodyBatterySource(hydrated);\n  $('feeling').value=hydrated.feeling||'ok';",'fill label');
replaceExact("function fillFromAuto(){const date=$('date').value||today;fill(applyAutoRecovery(date));renderAll()}",`function renderBodyBatterySource(e){const el=$('bbSourceLabel');if(!el)return;const v=num(e&&e.bodyBattery);if(v===null){el.textContent='Geen betrouwbare automatische waarde. Vul alleen dan manueel in.';return}if(manualTouched.bb||e.bodyBatterySource==='manual')el.textContent='Manueel overschreven: '+fmt0(v);else el.textContent='Automatisch uit Intervals: '+fmt0(v)+' (hoogste ochtendwaarde)'}
function fillFromAuto(){const date=$('date').value||today;fill(applyAutoRecovery(date));renderAll()}`,'source renderer');
replaceExact("['sleep','rhr','bb'].forEach(id=>$(id).addEventListener('input',()=>{manualTouched[id]=true;renderCoach()}));","['sleep','rhr','bb'].forEach(id=>$(id).addEventListener('input',()=>{manualTouched[id]=true;if(id==='bb')renderBodyBatterySource(currentForm());renderCoach()}));",'input handlers');
fs.writeFileSync(file,html);console.log('Wellness V3 patch applied');