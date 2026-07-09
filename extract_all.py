import marshal, zlib, dis
from types import CodeType

with open(r'D:\DDGameBox\地道游戏盒V14.exe', 'rb') as f:
    data = f.read()

start_offset = 606208
entry_offset = 27081
data_length = 35265
actual_offset = start_offset + entry_offset
raw = data[actual_offset:actual_offset + data_length]
decompressed = zlib.decompress(raw)
code_obj = marshal.loads(decompressed)

print("=== MODULE:", code_obj.co_name, "===")
print("File:", code_obj.co_filename)
print()

# Print all constants
print("=== ALL CONSTANTS ===")
for i, c in enumerate(code_obj.co_consts):
    if isinstance(c, str):
        if len(c) < 200:
            print(f"[{i}] str: '{c}'")
        else:
            print(f"[{i}] str({len(c)}): '{c[:200]}...'")
    elif isinstance(c, CodeType):
        print(f"[{i}] <Function/Class: {c.co_name}>")
    elif isinstance(c, bytes):
        print(f"[{i}] bytes({len(c)})")
    elif isinstance(c, tuple):
        items = [str(x)[:30] for x in c[:5]]
        print(f"[{i}] tuple({len(c)}): {items}")
    elif c is None:
        print(f"[{i}] None")
    else:
        print(f"[{i}] {type(c).__name__}: {str(c)[:60]}")

print()
print("=== NAMES ===")
for i, n in enumerate(code_obj.co_names):
    print(f"[{i}] {n}")

print()
print("=== SUB CODE OBJECTS ===")
for i, c in enumerate(code_obj.co_consts):
    if isinstance(c, CodeType):
        print()
        print(f"--- {c.co_name} ---")
        print(f"  Args: {list(c.co_varnames[:c.co_argcount])}")
        print(f"  Bytecode: {len(c.co_code)} bytes")
        print(f"  Names: {list(c.co_names)}")
        print(f"  Constants:")
        for j, const in enumerate(c.co_consts):
            if isinstance(const, str):
                if len(const) < 100:
                    print(f"    [{j}] '{const}'")
                else:
                    print(f"    [{j}] str({len(const)}): '{const[:100]}...'")
            elif isinstance(const, CodeType):
                print(f"    [{j}] <CodeType: {const.co_name}>")
            elif isinstance(const, tuple):
                print(f"    [{j}] tuple({len(const)})")
            elif const is None:
                print(f"    [{j}] None")
            elif isinstance(const, int):
                print(f"    [{j}] int: {const}")
            elif isinstance(const, bool):
                print(f"    [{j}] bool: {const}")
            else:
                print(f"    [{j}] {type(const).__name__}")
        
        print(f"  Bytecode (first 40 instructions):")
        try:
            instructions = list(dis.get_instructions(c))
            for inst in instructions[:40]:
                print(f"    {inst.offset:4d}: {inst.opname:<20s} {inst.argrepr}")
            if len(instructions) > 40:
                print(f"    ... ({len(instructions) - 40} more)")
        except Exception as e:
            print(f"  [dis error: {e}]")
