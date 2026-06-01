const fs = require('fs');
let c = fs.readFileSync('e:/AI大赛/科研绘图/SAM3/backend/llm_client.py', 'utf-8');
c = c.replace(/\r\n/g, '\n');

const idx = c.indexOf('return prompt\n\n\ndef _is_reasoning_model');
if (idx < 0) {
  process.exit(1);
}

// Build the python code line by line to avoid escaping nightmares
const pyCode = `
    # Append LOGIC SUMMARY section so the panel always shows after generation
    prompt += (
` +
'        "\\n\\n─── LOGIC SUMMARY ───\\n"' + '\n' +
'        "After all drawing instructions, output exactly ONE additional instruction describing the diagram\\'s overall logic:\\n"' + '\n' +
'        \'{"action":"logic_summary","params":{"text":"<2-4 sentence paragraph>"},"description":"Logic summary of the diagram"}\\n\'' + '\n' +
'        "Place this as the VERY LAST instruction. The text must be a coherent, academic-style paragraph explaining:\\n"' + '\n' +
'        "  • What the diagram depicts and its overall structure\\n"' + '\n' +
'        "  • The key relationships or flow being shown\\n"' + '\n' +
'        "  • The significance of the process or system\\n"' + '\n' +
'        "Write the summary in the same language as the diagram labels.\\n"' + '\n' +
'    )\n';

c = c.substring(0, idx) + 'return prompt' + pyCode + c.substring(idx + 'return prompt'.length);
fs.writeFileSync('e:/AI大赛/科研绘图/SAM3/backend/llm_client.py', c, 'utf-8');
console.log('OK');
