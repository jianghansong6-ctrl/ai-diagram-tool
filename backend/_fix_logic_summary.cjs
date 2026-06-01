const fs = require('fs');
let c = fs.readFileSync('e:/AI大赛/科研绘图/SAM3/backend/llm_client.py', 'utf-8');
c = c.replace(/\r\n/g, '\n');

const idx = c.indexOf('return prompt\n\n\ndef _is_reasoning_model');
if (idx < 0) {
  console.log('FAIL - pattern not found');
  process.exit(1);
}

const summaryLine = '\n    # Append LOGIC SUMMARY section to ALL prompt types so the panel always shows after generation\n    prompt += "\\n\\n─── LOGIC SUMMARY ───\\nAfter all drawing instructions, output exactly ONE additional instruction describing the diagram\\'s overall logic:\\n{\\"action\\":\\"logic_summary\\",\\"params\\":{\\"text\\":\\"<2-4 sentence paragraph>\\"},\\"description\\":\\"Logic summary of the diagram\\"}\\nPlace this as the VERY LAST instruction. The text must be a coherent, academic-style paragraph explaining:\\n  • What the diagram depicts and its overall structure\\n  • The key relationships or flow being shown\\n  • The significance of the process or system\\nWrite the summary in the same language as the diagram labels.\\n"\n';

c = c.substring(0, idx) + 'return prompt' + summaryLine + c.substring(idx + 'return prompt'.length);
fs.writeFileSync('e:/AI大赛/科研绘图/SAM3/backend/llm_client.py', c, 'utf-8');
console.log('OK');
