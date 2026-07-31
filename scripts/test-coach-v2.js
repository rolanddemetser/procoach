const assert = require('assert');

function decide({sleep=6, feeling='ok', stress='normaal', heavyYesterday=false, bb=null, bbMorning=false, rhrElevated=false}={}){
  const poor=[feeling==='moe',stress==='hoog'||stress==='zeer_hoog',heavyYesterday,bb!==null&&bb<35&&bbMorning,rhrElevated].filter(Boolean).length;
  if(feeling==='ziek'||feeling==='pijn') return 'stop';
  if(bb!==null&&bb<20&&bbMorning&&poor>=2) return 'stop';
  if(sleep<5) return 'recover';
  if(sleep<6&&poor>=1) return 'recover';
  if(poor>=2) return 'recover';
  return 'go';
}

const cases=[
  [{sleep:5.8,feeling:'goed',stress:'laag'},'go','5-6 uur zonder bijkomend signaal blijft GO'],
  [{sleep:5.8,feeling:'moe'},'recover','5-6 uur plus vermoeidheid wordt aangepast'],
  [{sleep:4.7,feeling:'goed'},'recover','minder dan 5 uur is geen STOP maar aangepast'],
  [{sleep:6.2,feeling:'moe',heavyYesterday:true},'recover','twee herstelsignalen geven aangepast'],
  [{sleep:6.2,feeling:'goed',stress:'laag'},'go','goede toestand volgt planning'],
  [{sleep:7,feeling:'ziek'},'stop','ziek blijft STOP'],
  [{sleep:7,feeling:'pijn'},'stop','pijn blijft STOP'],
  [{sleep:6,bb:18,bbMorning:true,feeling:'moe'},'stop','zeer lage ochtend-BB plus meerdere signalen stopt'],
  [{sleep:6,bb:18,bbMorning:true,feeling:'goed'},'go','BB alleen beslist niet']
];

for(const [input,expected,name] of cases){
  assert.strictEqual(decide(input),expected,name);
}
console.log(`OK: ${cases.length} coach-v2 scenario's geslaagd.`);
