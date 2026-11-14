const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const parse=new Function(source.slice(source.indexOf('function parseTechPassport('),source.indexOf('function applyPassportOcrFields('))+';return parseTechPassport;')();
test('bottom document serial never becomes a vehicle plate',()=>{
 for(const text of ['СТІ № 123456','CTI No 123456','CTI Noe 123456','СТІ Мо 123456','СТI\n№\n123456']){
  const r=parse(text);assert.equal(r.registration_certificate,'СТІ № 123456');assert.equal(r.plate,'');
 }
});
test('vehicle plate and document number remain separate',()=>{
 const r=parse('A BH1234AB\nD.1 RENAULT\nD.3 MEGANE\nB.2 2016\nСТІ № 123456');
 assert.equal(r.plate,'BH1234AB');assert.equal(r.year,'2016');assert.equal(r.registration_certificate,'СТІ № 123456');
});
test('ambiguous or truncated serials are not invented',()=>{
 for(const t of ['СТІ № 12345','СТІ № 1234567','TI No 123456','СТІ № 123456\nСХІ № 654321'])assert.equal(parse(t).registration_certificate,'');
});
test('explicit serial beats unlabelled background digits',()=>{
 assert.equal(parse('БАА 654321\nСТІ № 123456').registration_certificate,'СТІ № 123456');
});
test('digit confusions only repaired inside explicit serial',()=>{
 assert.equal(parse('CTI № I23O56').registration_certificate,'СТІ № 123056');
});
