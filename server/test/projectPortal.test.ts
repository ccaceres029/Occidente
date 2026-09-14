import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProjectPortal } from '../src/projectPortal/app.js';
import { ProjectStore } from '../src/projectPortal/store.js';
import type { Task } from '../src/projectPortal/model.js';

async function fixture(demo = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'occi-portal-test-'));
  const file = path.join(dir, 'project.json');
  const store = new ProjectStore(file);
  const app = await buildProjectPortal({ store, demo, staticDir: path.resolve('../portal'), origin: 'https://portal.test', secureCookie: false,
    bootstrap: demo ? undefined : { username: 'admin', name: 'Admin prueba', password: 'Test-only-secret-42' } });
  const close = async () => { await app.close(); await rm(dir, { recursive: true, force: true }); };
  const send = (url: string, method: 'GET'|'POST'|'PATCH' = 'GET', payload?: object, user='demo-admin', cookie='') => app.inject({
    url:'/api/portal'+url, method, payload, headers:{'x-portal-request':'1','x-demo-user':user, ...(cookie?{cookie}:{})},
  });
  return {app,store,file,close,send};
}
const draft = {title:'Verificar formulario',acceptance:'AFP confirma el resultado',description:'Prueba',sprint:1,priority:'MEDIA',kind:'TAREA',assigneeId:'demo-macao',dependencies:[],evidence:'https://example.com/evidencia'};

test('la API exige sesion real y no filtra hashes; el header demo no habilita acceso', async () => {
  const f=await fixture(false);try {
    assert.equal((await f.send('/project')).statusCode,401);
    const login=await f.send('/login','POST',{username:'admin',password:'Test-only-secret-42'});
    assert.equal(login.statusCode,200);
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    const res=await f.send('/project','GET',undefined,'demo-admin',cookie);
    assert.equal(res.statusCode,200);assert.equal(res.json().members.length,1);
    assert.equal(res.body.includes('password'),false);assert.equal(res.body.includes('"hash"'),false);assert.equal(res.body.includes('"salt"'),false);assert.equal(res.body.includes('"sessions"'),false);
    assert.match(String(login.headers['set-cookie']),/HttpOnly/);assert.match(String(login.headers['set-cookie']),/SameSite=Strict/);
    await f.send('/logout','POST',{},'demo-admin',cookie);
    assert.equal((await f.send('/project','GET',undefined,'demo-admin',cookie)).statusCode,401);
  } finally {await f.close();}
});
test('rechaza solicitudes cross-origin y escrituras sin header CSRF',async()=>{
  const f=await fixture();try{
    assert.equal((await f.app.inject({url:'/api/portal/tasks',method:'POST',payload:draft})).statusCode,403);
    assert.equal((await f.app.inject({url:'/api/portal/tasks',method:'POST',payload:draft,headers:{'x-portal-request':'1',origin:'https://evil.test'}})).statusCode,403);
  }finally{await f.close();}
});
test('consulta no escribe y AFP no crea ni modifica tareas',async()=>{
  const f=await fixture();try{
    for(const role of ['demo-viewer','demo-afp'])assert.equal((await f.send('/tasks','POST',draft,role)).statusCode,403);
    assert.equal((await f.send('/tasks/entrega-1/comments','POST',{text:'hola'},'demo-viewer')).statusCode,403);
    assert.equal((await f.send('/tasks/entrega-1','PATCH',{version:1,title:'Cambiar'},'demo-afp')).statusCode,403);
    assert.equal((await f.send('/project','GET',undefined,'demo-viewer')).statusCode,200);
  }finally{await f.close();}
});
test('rechaza fechas, evidencia activa, dependencias inexistentes y entrada invalida',async()=>{
  const f=await fixture();try{
    for(const invalid of [{evidence:'javascript:alert(1)'},{evidence:'https://user:secret@example.com'},{dueDate:'2026-02-30'},{sprint:9},{dependencies:['missing']},{acceptance:''},{assigneeId:'demo-viewer'}]){
      assert.equal((await f.send('/tasks','POST',{...draft,...invalid})).statusCode,400);
    }
    assert.equal((await f.send('/tasks','POST',{...draft,title:'<script>alert(1)</script>'})).statusCode,200);
  }finally{await f.close();}
});
test('aceptacion requiere etapas, evidencia, responsable, observacion y rol AFP',async()=>{
  const f=await fixture();try{
    let t=(await f.send('/tasks','POST',draft)).json<Task>();
    assert.equal((await f.send(`/tasks/${t.id}/status`,'POST',{version:t.version,status:'VALIDACION_AFP'})).statusCode,400);
    for(const status of ['EN_DESARROLLO','PRUEBAS_MACAO','VALIDACION_AFP'])t=(await f.send(`/tasks/${t.id}/status`,'POST',{version:t.version,status},'demo-macao')).json<Task>();
    assert.equal((await f.send(`/tasks/${t.id}/status`,'POST',{version:t.version,status:'ACEPTADO',note:'OK'},'demo-macao')).statusCode,403);
    assert.equal((await f.send(`/tasks/${t.id}/status`,'POST',{version:t.version,status:'ACEPTADO'},'demo-afp')).statusCode,400);
    const accepted=await f.send(`/tasks/${t.id}/status`,'POST',{version:t.version,status:'ACEPTADO',note:'Prueba validada'},'demo-afp');
    assert.equal(accepted.statusCode,200);t=accepted.json<Task>();assert.equal(t.status,'ACEPTADO');
    assert.equal((await f.send(`/tasks/${t.id}`,'PATCH',{version:t.version,title:'Cambiar aceptado'})).statusCode,409);
    const events=(await f.send('/project')).json().events;
    assert.ok(events.some((e:any)=>e.actorId==='demo-afp'&&e.detail.includes('Prueba validada')));
  }finally{await f.close();}
});
test('actualizaciones concurrentes rechazan version obsoleta y persisten una sola',async()=>{
  const f=await fixture();try{
    const result=await Promise.all([f.send('/tasks/entrega-1','PATCH',{version:1,title:'A'}),f.send('/tasks/entrega-1','PATCH',{version:1,title:'B'})]);
    assert.deepEqual(result.map(r=>r.statusCode).sort(),[200,409]);
    const reread=new ProjectStore(f.file);await reread.initialize();const p=await reread.read();
    assert.equal(p.tasks[0].version,2);assert.equal(p.events.filter(e=>e.action==='Tarea actualizada').length,1);
  }finally{await f.close();}
});
test('fallos no envenenan la cola y dependencias ciclicas son rechazadas',async()=>{
  const f=await fixture();try{
    const a=await f.send('/tasks/entrega-1','PATCH',{version:1,dependencies:['entrega-2']});assert.equal(a.statusCode,200);
    assert.equal((await f.send('/tasks/entrega-2','PATCH',{version:1,dependencies:['entrega-1']})).statusCode,400);
    assert.equal((await f.send('/tasks/entrega-2','PATCH',{version:1,title:'Sin ciclo'})).statusCode,200);
    assert.equal((await f.send('/tasks/entrega-2/archive','POST',{version:2,reason:'No procede'})).statusCode,400);
  }finally{await f.close();}
});
test('bloqueo impide avance, resolucion y comentarios dejan actor del servidor',async()=>{
  const f=await fixture();try{
    const block=await f.send('/tasks/entrega-1/block','POST',{version:1,reason:'Falta matriz',actorId:'suplantado'},'demo-macao');assert.equal(block.statusCode,200);
    assert.equal((await f.send('/tasks/entrega-1/status','POST',{version:2,status:'EN_DESARROLLO'})).statusCode,400);
    assert.equal((await f.send('/tasks/entrega-1/block','POST',{version:2,reason:''})).statusCode,200);
    await f.send('/tasks/entrega-1/comments','POST',{text:'Matriz recibida',actorId:'suplantado'},'demo-afp');
    const p=await f.store.read();assert.equal(p.comments[0].actorId,'demo-afp');assert.equal(p.tasks[0].blocked,'');
  }finally{await f.close();}
});
test('calendario valida lunes, permisos y concurrencia',async()=>{
  const f=await fixture();try{
    const fields={version:1,startDate:'2026-09-14',morazanicaPause:true,virtualDay:3,reason:'Acuerdo de prueba'};
    assert.equal((await f.send('/settings','PATCH',fields,'demo-afp')).statusCode,403);
    assert.equal((await f.send('/settings','PATCH',{...fields,startDate:'2026-09-15'})).statusCode,400);
    assert.equal((await f.send('/settings','PATCH',{...fields,virtualDay:7})).statusCode,400);
    assert.equal((await f.send('/settings','PATCH',fields)).statusCode,200);
    assert.equal((await f.store.read()).virtualDay,3);
    assert.equal((await f.send('/project','GET')).json().project.virtualDay,3);
    assert.equal((await f.send('/settings','PATCH',fields)).statusCode,409);
  }finally{await f.close();}
});
test('cuentas reales: alta, acceso de consulta, desactivacion y ultimo administrador',async()=>{
  const f=await fixture(false);try{
    const login=await f.send('/login','POST',{username:'admin',password:'Test-only-secret-42'}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const m=await f.send('/members','POST',{username:'consulta',name:'Consulta',role:'CONSULTA',password:'Test-only-viewer-42'},'',cookie);assert.equal(m.statusCode,200);
    const v=await f.send('/login','POST',{username:'consulta',password:'Test-only-viewer-42'}),vc=String(v.headers['set-cookie']).split(';')[0];
    assert.equal((await f.send('/project','GET',undefined,'',vc)).statusCode,200);
    assert.equal((await f.send('/tasks','POST',draft,'',vc)).statusCode,403);
    assert.equal((await f.send('/members/'+m.json().id,'PATCH',{active:false,role:'CONSULTA'},'',cookie)).statusCode,200);
    assert.equal((await f.send('/project','GET',undefined,'',vc)).statusCode,401);
    assert.equal((await f.send('/members/'+login.json().user.id,'PATCH',{active:false,role:'ADMIN'},'',cookie)).statusCode,400);
  }finally{await f.close();}
});
test('esquema propio y activos estaticos no exponen archivos del servidor',async()=>{
  const f=await fixture();try{
    for(const url of ['/.env','/server/data/project-portal-demo.json','/api/cases'])assert.equal((await f.app.inject({url})).statusCode,404);
    const html=await f.app.inject({url:'/'});assert.equal(html.statusCode,200);assert.match(String(html.headers['content-security-policy']),/frame-ancestors 'none'/);
  }finally{await f.close();}
});
