import zlib
import marshal
import sys
import dis
from types import CodeType

def decompile_code_to_source(code_obj, indent=0):
    """Extract structure from a code object"""
    result = []
    prefix = "    " * indent
    
    result.append(f"{prefix}# ---- Code Object: {code_obj.co_name} ----")
    result.append(f"{prefix}# File: {code_obj.co_filename}")
    result.append(f"{prefix}# Args: {code_obj.co_varnames[:10] if code_obj.co_varnames else '()'}")
    result.append(f"{prefix}# Flag: {hex(code_obj.co_flags)}")
    result.append("")
    
    # Names
    result.append(f"{prefix}# NAMES ({len(code_obj.co_names)}):")
    for i, name in enumerate(code_obj.co_names):
        result.append(f"{prefix}#   {i:3d}: {name}")
    result.append("")
    
    # Constants - strings
    result.append(f"{prefix}# STRING CONSTANTS:")
    for i, c in enumerate(code_obj.co_consts):
        if isinstance(c, str):
            preview = c[:150] if len(c) > 150 else c
            result.append(f"{prefix}#   [{i:3d}] str({len(c)}): \"{preview}\"")
        elif isinstance(c, CodeType):
            result.append(f"{prefix}#   [{i:3d}] <CodeType '{c.co_name}'> -> see below")
            result.append("")
            result.extend(decompile_code_to_source(c, indent + 2))
        elif isinstance(c, int):
            result.append(f"{prefix}#   [{i:3d}] int: {c}")
        elif isinstance(c, type(None)):
            result.append(f"{prefix}#   [{i:3d}] None")
        elif isinstance(c, bytes):
            result.append(f"{prefix}#   [{i:3d}] bytes({len(c)})")
        elif isinstance(c, tuple):
            result.append(f"{prefix}#   [{i:3d}] tuple({len(c)}): {c[:5]}...")
        else:
            result.append(f"{prefix}#   [{i:3d}] {type(c).__name__}")
    result.append("")
    
    # Bytecode disassembly (first 100 instructions)
    result.append(f"{prefix}# BYTECODE ({len(code_obj.co_code)} bytes):")
    try:
        instructions = list(dis.get_instructions(code_obj))
        for inst in instructions[:100]:
            result.append(f"{prefix}#   {inst.offset:4d}: {inst.opname:<20s} {inst.argrepr if inst.argrepr else ''}")
        if len(instructions) > 100:
            result.append(f"{prefix}#   ... ({len(instructions) - 100} more instructions)")
    except Exception as e:
        result.append(f"{prefix}#   [dis error: {e}]")
    
    result.append("")
    return result


# Open and extract
with open(r'D:\DDGameBox\地道游戏盒V14.exe', 'rb') as f:
    data = f.read()

start_offset = 606208
entry_offset = 27081
data_length = 35265

actual_offset = start_offset + entry_offset
raw = data[actual_offset:actual_offset + data_length]
decompressed = zlib.decompress(raw)

# Unmarshal the code object
code_obj = marshal.loads(decompressed)

# Extract decompiled content
lines = decompile_code_to_source(code_obj)

# Write output
with open(r'D:\DDGameBox\extracted_code.py', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f"Written {len(lines)} lines to extracted_code.py")

# Print the key constants directly
print("\n=== KEY API ENDPOINTS ===")
for i, c in enumerate(code_obj.co_consts):
    if isinstance(c, str) and 'http' in c.lower():
        print(f"  [{i}] {c}")
    if isinstance(c, str) and ('api' in c.lower() or 'url' in c.lower()):
        print(f"  [{i}] {c}")

print(f"\n=== ALL NAMES ===")
for name in code_obj.co_names:
    print(f"  {name}")

print(f"\n=== CODE OBJECTS (classes/functions) ===")
for i, c in enumerate(code_obj.co_consts):
    if isinstance(c, CodeType):
        print(f"  [{i}] {c.co_name} ({len(c.co_code)} bytes, {len(c.co_names)} names)")
        # Show first few names
        if c.co_names:
            print(f"       Names: {list(c.co_names[:10])}")
