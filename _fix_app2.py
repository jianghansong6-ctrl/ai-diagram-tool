# encoding: utf-8
FP = 'e:/AI大赛/科研绘图/SAM3/frontend/src/App.jsx'
with open(FP, 'r', encoding='utf-8') as f:
    c = f.read()

old1 = """      case 'complete':
        setComplete(true)
        setIsPaused(false)
        setIsGenerating(false)
        // Extract logic summary from instructions if not already set
        setInstructions(prev => {
          const ls = prev.find(i => i.action === 'logic_summary')
          if (ls) setLogicSummary(ls.params?.text || '')
          return prev.filter(i => i.action !== 'logic_summary')
        })
        break"""

new1 = """      case 'complete':
        setComplete(true)
        setIsPaused(false)
        setIsGenerating(false)
        break"""

c = c.replace(old1, new1)

old2 = """      case 'instruction':
        if (data.action === 'logic_summary') {
          setLogicSummary(data.params?.text || '')
        }
        setInstructions(prev => [...prev, data])
        instCountRef.current += 1
        if (!firstInstTimeRef.current) {
          firstInstTimeRef.current = Date.now()
        }
        break"""

new2 = """      case 'instruction':
        if (data.action === 'logic_summary') {
          setLogicSummary(data.params?.text || '')
        } else {
          setInstructions(prev => [...prev, data])
          instCountRef.current += 1
          if (!firstInstTimeRef.current) {
            firstInstTimeRef.current = Date.now()
          }
        }
        break"""

c = c.replace(old2, new2)

with open(FP, 'w', encoding='utf-8') as f:
    f.write(c)
print('Fixed App.jsx')
