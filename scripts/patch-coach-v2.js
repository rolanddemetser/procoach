const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'index.html');
let html = fs.readFileSync(file, 'utf8');

const oldCoach = /function coach\(e=currentForm\(\)\)\{[\s\S]*?\n\}/;
const match = html.match(oldCoach);
if (!match) {
  throw new Error('coach() function not found; index.html structure changed');
}

const replacement = `function coach(e=currentForm()){
  e=deriveYesterday(e);
  const reasons=[];
  const sleep=num(e.sleepHours),bb=num(e.bodyBattery),bbMorning=e.bodyBatteryMorning===true||e.bodyBatterySource==='manual',rhr=num(e.rhr),stepsY=num(e.yesterdaySteps),walkY=num(e.yesterdayWalkMin)||0,activityY=num(e.yesterdayActivityMin)||0,stress=normalizeStress(e.stressFeeling),feeling=e.feeling||'ok';
  const heavyYesterday=(stepsY!==null&&stepsY>=12000)||walkY>=60||activityY>=75;
  const poorRecoverySignals=[feeling==='moe',stress==='hoog'||stress==='zeer_hoog',heavyYesterday,bb!==null&&bb<35&&bbMorning,isRhrElevated(rhr,e.date)].filter(Boolean).length;
  let mode='go',title='GO — VOLG DE WEEKPLANNING',actions=['Voer de geplande activiteiten uit','Start rustig en evalueer na 10 minuten','Pas alleen aan bij duidelijke vermoeidheid of pijn'],dont=['Niet maximaliseren','Niet compenseren','Geen extra belasting bij pijn'];

  if(feeling==='ziek'){
    mode='stop';
    reasons.push('Ziek gevoel: herstel is vandaag de training.');
  } else if(feeling==='pijn'){
    mode='stop';
    reasons.push('Pijn gemeld: veiligheid gaat voor.');
  } else if(bb!==null&&bb<20&&bbMorning&&poorRecoverySignals>=2){
    mode='stop';
    reasons.push('Zeer lage Body Battery samen met meerdere herstelsignalen.');
  }

  if(mode!=='stop'){
    if(sleep!==null&&sleep<5){
      reasons.push('Minder dan 5 uur slaap: zware onderdelen worden beperkt.');
      mode='recover';
    } else if(sleep!==null&&sleep<6&&poorRecoverySignals>=1){
      reasons.push('Korter dan 6 uur slaap telt alleen mee door bijkomende herstelsignalen.');
      mode='recover';
    }

    if(feeling==='moe')reasons.push('Je voelt je moe: kies de lichtere versie van de planning.');
    if(stress==='hoog'||stress==='zeer_hoog')reasons.push('Stress is verhoogd: intensiteit beperken.');
    if(stepsY!==null&&stepsY>=12000)reasons.push('Gisteren veel stappen: dit telt als belasting.');
    if(walkY>=60)reasons.push('Gisteren minstens 60 minuten gewandeld.');
    if(activityY>=75)reasons.push('Gisteren veel totale activiteit.');
    if(bb!==null&&bb<35&&bbMorning)reasons.push('Body Battery bij opstaan is laag.');
    if(isRhrElevated(rhr,e.date))reasons.push('Rusthartslag ligt boven je recente baseline.');

    if(mode==='go'&&poorRecoverySignals>=2)mode='recover';

    if(mode==='recover'){
      title='AANGEPAST — BEHOUD DE LICHTE ACTIVITEITEN';
      actions=['Behoud rustige wandeling, mobiliteit of yoga','Kort belastende activiteiten in of stel ze uit','Start rustig en stop bij duidelijke verslechtering'];
      dont=['Geen zware kracht','Geen versnellingen','Geen extra lange wandeling'];
    }
  }

  if(mode==='stop'){
    title='STOP — HERSTEL EERST';
    actions=['Rust: herstel is de training','Alleen zeer rustig bewegen als dat goed voelt','Zoek medische hulp bij alarmsymptomen'];
    dont=['Geen kracht','Geen versnellingen','Geen lange wandeling'];
  }

  if(!reasons.length)reasons.push('Herstel is voldoende; de bestaande weekplanning blijft leidend.');
  return{mode,title,actions,dont,reasons:reasons.slice(0,4),ctx:{sleep,bb,bbMorning,rhr,stepsY,walkY,activityY,stress,feeling},y:getActivityDay(addDays(e.date,-1))||{}};
}`;

html = html.replace(oldCoach, replacement);
html = html.replace('<title>ProCoach V32</title>', '<title>ProCoach V33 Coach v2</title>');
html = html.replace('ProCoach V32 🧠', 'ProCoach V33 🧠');
fs.writeFileSync(file, html);
console.log('Coach v2 patch applied successfully.');
