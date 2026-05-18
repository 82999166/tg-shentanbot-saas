
import re

with open("/home/hjroot/shentanbot/web/client/src/pages/GroupScrape.tsx", "r") as f:
    content = f.read()

# Find ExtractTab function
pattern = r'function ExtractTab\(\)\s*\{[\s\S]*?\n\}\s*$'
# This is tricky - let's find it by line numbers instead

lines = content.split("\n")
start_idx = None
for i, line in enumerate(lines):
    if "function ExtractTab()" in line:
        start_idx = i
        break

if start_idx is None:
    print("ERROR: ExtractTab not found!")
    exit(1)

print(f"ExtractTab found at line {start_idx + 1}")

# Find the matching closing brace
brace_count = 0
end_idx = start_idx
for i in range(start_idx, len(lines)):
    brace_count += lines[i].count("{") - lines[i].count("}")
    if brace_count == 0 and i > start_idx:
        end_idx = i
        break

print(f"ExtractTab ends at line {end_idx + 1}")
print(f"ExtractTab is {end_idx - start_idx + 1} lines long")

# Save the original ExtractTab
original = "\n".join(lines[start_idx:end_idx+1])
with open("/home/hjroot/shentanbot/web/client/src/pages/ExtractTab_backup.txt", "w") as f:
    f.write(original)
print("Original ExtractTab backed up")

# Replace with minimal version
minimal = """function ExtractTab() {
  return (
    <div className="p-8 text-center">
      <h2 className="text-lg font-bold">消息提取链接 (测试)</h2>
      <p className="text-slate-500 mt-2">ExtractTab 组件加载成功</p>
    </div>
  );
}"""

lines[start_idx:end_idx+1] = minimal.split("\n")
new_content = "\n".join(lines)

with open("/home/hjroot/shentanbot/web/client/src/pages/GroupScrape.tsx", "w") as f:
    f.write(new_content)
print("ExtractTab replaced with minimal version")
