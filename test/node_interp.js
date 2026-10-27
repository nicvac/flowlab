const E=require('../src/expr.js'), M=require('../src/model.js'), {Interpreter}=require('../src/interp.js');
const S=M.makeStmt;
function run(prog, inputs=[]){
  let out=''; const env={output:(t,nl)=>{out+=t+(nl?'\n':'')}, eof:()=>true, fileOpen(){},fileClose(){},fileRead(){},fileWrite(){}};
  const it=new Interpreter(prog,env); const g=it.run(); let r=g.next(); let steps=0;
  try{ while(!r.done){ steps++; if(r.value.type==='input') r=g.next(inputs.shift()); else r=g.next(); } }catch(e){ out+='ERR: '+e.message+' @'+e.stmtId+'\n'; }
  return out;
}
const p=M.newProgram(); const main=p.functions[0];
main.body=[S('declare',{name:'n, i',type:'Integer'}),S('declare',{name:'r',type:'Real'}),
 S('input',{variable:'n'}),
 S('for',{variable:'i',start:'1',end:'n',body:[S('output',{expression:'i & " al quadrato = " & i^2'})]}),
 S('assign',{variable:'r',expression:'7 / 2'}), S('output',{expression:'r'}),
 S('output',{expression:'Fatt(5)'}),
 S('output',{expression:'-2^2 & " " & 10 mod 3 & " " & 0.1+0.2 & " " & Sqrt(2) & " " & ToFixed(Pi,3) & " " & Char("ciao",1) & " " & Len("àbc")'}),
 S('output',{expression:'not 3 > 5 and true'}),
 S('declare',{name:'v',type:'Integer',array:true,size:'3'}), S('assign',{variable:'v[0]',expression:'4'}),S('assign',{variable:'v[1]',expression:'1'}),S('assign',{variable:'v[2]',expression:'9'}),
 S('call',{expression:'Ordina(v)'}), S('output',{expression:'v[0] & "," & v[1] & "," & v[2] & " size=" & size(v)'}),
 S('assign',{variable:'i',expression:'0'}),
 S('do',{expression:'i < 3',body:[S('assign',{variable:'i',expression:'i+1'})]}), S('output',{expression:'"do:" & i'}),
 S('output',{expression:'1/0'}),
];
const f=M.makeFunction('Fatt',{type:'Integer',variable:'r',params:[{name:'n',type:'Integer',array:false}]});
f.body=[S('declare',{name:'r',type:'Integer'}),S('if',{expression:'n <= 1',then:[S('assign',{variable:'r',expression:'1'})],else:[S('assign',{variable:'r',expression:'n * Fatt(n-1)'})]})];
const o=M.makeFunction('Ordina',{params:[{name:'a',type:'Integer',array:true}]});
o.body=[S('declare',{name:'i, j, t',type:'Integer'}),S('for',{variable:'i',start:'0',end:'size(a)-2',body:[S('for',{variable:'j',start:'0',end:'size(a)-2-i',body:[S('if',{expression:'a[j] > a[j+1]',then:[S('assign',{variable:'t',expression:'a[j]'}),S('assign',{variable:'a[j]',expression:'a[j+1]'}),S('assign',{variable:'a[j+1]',expression:'t'})]})]})]})];
p.functions.push(f,o);
console.log(run(p,['abc','3']));
