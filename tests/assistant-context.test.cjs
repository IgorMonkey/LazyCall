const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { replyBlock, transcriptContext, assistantHistory, replyContract } = require(path.join(process.env.CALLME_TEST_BUILD || path.join(__dirname, '../dist-electron'), 'assistant-context'));
const line = (id, text, source = 'remote', startMs = Number(id) * 5000) => ({ id: String(id), text, source, startMs, endMs: startMs + 4500 });

test('split technical question keeps its preceding chunks and stops before later dialog', () => {
  const lines = [line(0, 'Да', 'self'), line(1, 'Выплата через смарт-контракт.'), line(2, 'Ключи multisig вставляются'), line(3, 'или как?'), line(4, 'НЕ ДРУГОЙ ВОПРОС?')];
  assert.deepEqual(replyBlock(lines, lines[3]).map(l => l.id), ['1', '2', '3']);
  const selected = transcriptContext(lines, 'Предложи ответ', lines[3]);
  assert(selected.some(l => l.id === '1')); assert(!selected.some(l => l.id === '4'));
  const contract = replyContract(lines[3], replyBlock(lines, lines[3]), true);
  assert(contract.includes('Выплата через смарт-контракт.'));
  assert(contract.includes('repo_read')); assert(contract.includes('не заменяй весь ответ встречным'));
});

test('long meeting retains earlier technical evidence, not only the last thirty chunks', () => {
  const lines = [line(0, 'Порог подписей multisig определяется контрактом.'), line(1, 'Проверяем согласованный вариант.', 'self')];
  for (let i = 2; i < 90; i++) lines.push(line(i, 'Обычное обсуждение сроков.'));
  lines.push(line(90, 'Где определяется порог подписей multisig?'));
  const selected = transcriptContext(lines, lines.at(-1).text, lines.at(-1));
  assert(selected.some(l => l.id === '0')); assert(selected.some(l => l.id === '1'));
  assert(selected.some(l => l.id === '90')); assert(selected.length < 50);
});

test('many automatic hints do not evict user requests or turn a failed answer into context', () => {
  const messages = [{ id: 'manual', role: 'user', kind: 'answer', state: 'done', text: 'Отвечай в контексте сервиса', createdAt: 0 }];
  for (let i = 1; i < 50; i++) {
    messages.push({ id: `u${i}`, role: 'user', kind: 'answer', origin: 'reply', state: 'done', text: 'Автоматическая реплика', createdAt: i * 2 });
    messages.push({ id: `a${i}`, role: 'assistant', kind: 'answer', state: 'done', text: 'Ответ', createdAt: i * 2 + 1 });
  }
  messages.push({ id: 'error', role: 'assistant', kind: 'answer', state: 'error', text: 'НЕ ПЕРЕДАВАТЬ ОШИБКУ', createdAt: 150 });
  const result = assistantHistory(messages);
  assert(result.text.includes('Отвечай в контексте сервиса')); assert(!result.text.includes('Автоматическая реплика'));
  assert(!result.text.includes('НЕ ПЕРЕДАВАТЬ ОШИБКУ')); assert.equal(result.manualRequests, 1);
});

test('legacy generated requests are distinguished from manually typed messages', () => {
  const base = { role: 'user', kind: 'answer', state: 'done', createdAt: 0 };
  const result = assistantHistory([{ ...base, id: 'old-reply', text: 'Предложи ответ на реплику 12:34:\n«Как?»' }, { ...base, id: 'manual', text: 'Проверь сервис авторизации' }]);
  assert.equal(result.manualRequests, 1); assert(result.text.includes('Проверь сервис авторизации'));
});
