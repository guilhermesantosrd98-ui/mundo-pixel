const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {WebSocketServer}=require('ws');

const PORT=process.env.PORT||3000;
const DB_FILE=process.env.DB_FILE||path.join(__dirname,'names.json');
const CLS=['Guerreiro','Mago','Arqueiro'];
const NAME_RE=/^[A-Za-z0-9_]{3,14}$/;

let names={};
try{names=JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}catch(e){names={};}
let dirtyDB=false;
setInterval(()=>{
  if(!dirtyDB)return;
  dirtyDB=false;
  fs.writeFile(DB_FILE,JSON.stringify(names),e=>{if(e)console.error('erro ao salvar:',e.message);});
},3000);

const int=(v,min,max,def)=>{const n=Math.floor(Number(v));return Number.isFinite(n)?Math.min(max,Math.max(min,n)):def;};
const num=(v,max,def)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(0,n)):def;};
function cleanSave(d){
  d=d||{};
  const sk=d.sk||{},sx=d.sx||{};
  return{cls:CLS.includes(d.cls)?d.cls:'Guerreiro',lv:int(d.lv,1,1000000,1),xp:num(d.xp,1e15,0),gold:num(d.gold,1e15,0),
    pot:int(d.pot,0,999,0),bonus:num(d.bonus,100,0),spd:num(d.spd,10,0),x:int(d.x,0,149,0),y:int(d.y,0,109,0),
    sk:{mg:int(sk.mg,0,1e6,0),me:int(sk.me,0,1e6,0),gu:int(sk.gu,0,1e6,0)},
    sx:{mg:num(sx.mg,1e12,0),me:num(sx.me,1e12,0),gu:num(sx.gu,1e12,0)}};
}

const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url.startsWith('/?')){
    fs.readFile(path.join(__dirname,'index.html'),(err,data)=>{
      if(err){res.writeHead(500);return res.end('index.html nao encontrado');}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(data);
    });
  }else{res.writeHead(404);res.end('nao encontrado');}
});

const wss=new WebSocketServer({server,path:'/ws',maxPayload:8192});
const clients=new Map();
let seq=0;
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o));};

wss.on('connection',ws=>{
  const c={ws,id:'p'+(++seq)+crypto.randomBytes(3).toString('hex'),name:null,authed:false,pres:null,lastChat:0};
  clients.set(c.id,c);
  send(ws,{type:'welcome',id:c.id});

  ws.on('message',raw=>{
    let m;
    try{m=JSON.parse(String(raw));}catch(e){return;}
    if(!m||typeof m!=='object')return;

    if(m.type==='check'){
      const n=String(m.name||'');
      const rec=names[n.toLowerCase()];
      send(ws,{type:'avail',name:n,ok:!rec&&NAME_RE.test(n),own:!!(rec&&m.token&&m.token===rec.token)});

    }else if(m.type==='claim'){
      const n=String(m.name||'');
      if(!NAME_RE.test(n)){send(ws,{type:'claimed',ok:false,why:'nome invalido'});return;}
      const key=n.toLowerCase(),rec=names[key];
      if(!rec){
        const token=crypto.randomBytes(16).toString('hex');
        names[key]={name:n,token:token,data:cleanSave({cls:m.cls})};
        dirtyDB=true;
        Object.assign(c,{name:n,authed:true});
        send(ws,{type:'claimed',ok:true,name:n,token:token,save:null});
      }else if(m.token&&m.token===rec.token){
        Object.assign(c,{name:n,authed:true});
        send(ws,{type:'claimed',ok:true,name:n,token:rec.token,save:rec.data});
      }else{
        send(ws,{type:'claimed',ok:false,why:'Esse nome ja foi utilizado.'});
      }

    }else if(m.type==='pres'&&c.authed){
      const p=m.p||{};
      c.pres={n:c.name,c:CLS.includes(p.c)?p.c:'Guerreiro',x:int(p.x,0,149,0),y:int(p.y,0,109,0),
        f:['u','d','l','r'].includes(p.f)?p.f:'d',l:int(p.l,1,1000000,1)};

    }else if(m.type==='save'&&c.authed){
      const rec=names[c.name.toLowerCase()];
      if(rec){rec.data=cleanSave(m.d);dirtyDB=true;}

    }else if(m.type==='chat'&&c.authed){
      const now=Date.now();
      const t=String(m.t||'').trim().slice(0,80);
      if(!t||now-c.lastChat<800)return;
      c.lastChat=now;
      for(const o of clients.values())if(o!==c)send(o.ws,{type:'chat',peer:c.id,n:c.name,t:t});
    }
  });

  ws.on('close',()=>clients.delete(c.id));
});

setInterval(()=>{
  const list=[];
  for(const c of clients.values())if(c.authed&&c.pres)list.push({peer:c.id,presence:c.pres});
  for(const c of clients.values())send(c.ws,{type:'peers',list:list});
},100);

server.listen(PORT,()=>console.log('Mundo Pixel rodando na porta '+PORT));
