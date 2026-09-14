import test from 'node:test';
import assert from 'node:assert/strict';
import { sprintCalendar, holiday, addDays } from './calendar.js';

test('reunion configurable respeta la pausa y desplaza la fecha con el sprint', () => {
  for (let day=0;day<7;day++) {
    const rows=sprintCalendar('2026-09-14',true,day);
    assert.equal(rows[0].virtual,addDays('2026-09-14',day));
    assert.equal(rows[3].virtual,null);
    assert.equal(rows[4].virtual,addDays('2026-10-12',day));
  }
  assert.throws(()=>sprintCalendar(null,true,7));
});

test('sin inicio conserva ocho sprints relativos', () => {
  const rows = sprintCalendar(null, true);
  assert.equal(rows.length, 8); assert.equal(rows[7].sprint, 8); assert.equal(rows[0].start, null);
});
test('Morazanica desplaza los sprints sin perder entregas ni agendar el sabado 10', () => {
  const rows = sprintCalendar('2026-09-14', true);
  assert.equal(rows.length, 9); assert.equal(rows[3].sprint, null);
  assert.equal(rows[4].sprint, 4); assert.equal(rows[4].start, '2026-10-12');
  assert.equal(rows[8].end, '2026-11-15');
  assert.equal(rows.some(r => r.saturday === '2026-10-10'), false);
});
test('sin pausa hay capacidad reducida y feriado marcado, sin inventar recuperacion', () => {
  const rows = sprintCalendar('2026-09-14', false);
  assert.equal(rows.length, 8); assert.equal(rows[7].end, '2026-11-08');
  assert.match(holiday(rows[3].saturday), /Sin revisión/);
  assert.match(holiday(rows[3].virtual), /12:00/);
});
test('una pausa fuera del proyecto no agrega semanas', () => assert.equal(sprintCalendar('2026-10-12', true).length, 8));
test('inicio durante pausa conserva todos los sprints y muestra la espera', () => {
  const rows=sprintCalendar('2026-10-05', true);assert.equal(rows[0].sprint,null);assert.equal(rows[1].sprint,1);assert.equal(rows.length,9);
});
test('aritmetica UTC, fechas invalidas y limites de año', () => {
  assert.equal(addDays('2026-12-28',7),'2027-01-04');
  assert.throws(()=>sprintCalendar('2026-09-15',true),/lunes/);
  assert.throws(()=>sprintCalendar('2026-02-30',true));
  assert.equal(holiday('2026-09-15'),'Independencia');
  assert.equal(holiday('2027-10-07'),'');
});
