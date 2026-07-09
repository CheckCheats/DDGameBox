import zlib, marshal, dis, sys
from types import CodeType

# Extract ddv20.exe main script
from PyInstaller.archive.readers import CArchiveReader

archive = CArchiveReader(r"D:\DDGameBox\DepotDownloader\ddv20.exe")
print(f"TOC entries: {len(archive.toc)}")
print(f"_start_offset: {archive._start_offset}")

# Find ddv20 main script
for name, entry in archive.toc.items():
    if name == "ddv20":
        entry_offset, data_length, uncompressed_len, compression_flag, typecode = entry
        print(f"Found ddv20: offset={entry_offset}, size={data_length}, uncomp={uncompressed_len}")
        
        with open(r"D:\DDGameBox\DepotDownloader\ddv20.exe", "rb") as f:
            data = f.read()
        
        actual_offset = archive._start_offset + entry_offset
        raw = data[actual_offset:actual_offset + data_length]
        decompressed = zlib.decompress(raw)
        code_obj = marshal.loads(decompressed)
        
        print(f"\nModule: {code_obj.co_name}")
        print(f"Filename: {code_obj.co_filename}")
        print(f"\n=== NAMES ({len(code_obj.co_names)}) ===")
        for i, n in enumerate(code_obj.co_names):
            print(f"  [{i}] {n}")
        
        print(f"\n=== STRING CONSTANTS ===")
        for i, c in enumerate(code_obj.co_consts):
            if isinstance(c, str):
                if len(c) < 150:
                    print(f"  [{i}] \"{c}\"")
                else:
                    print(f"  [{i}] str({len(c)}): \"{c[:150]}...\"")
            elif isinstance(c, CodeType):
                print(f"  [{i}] <CodeType: {c.co_name}>")
            elif isinstance(c, int):
                print(f"  [{i}] int: {c}")
            elif c is None:
                print(f"  [{i}] None")
            elif isinstance(c, tuple):
                items = list(c[:3]) if len(c) > 3 else list(c)
                print(f"  [{i}] tuple({len(c)}): {items}")
        
        print(f"\n=== SUB CODE OBJECTS ===")
        for i, c in enumerate(code_obj.co_consts):
            if isinstance(c, CodeType):
                print(f"\n  [{i}] {c.co_name}")
                print(f"    Args: {list(c.co_varnames[:c.co_argcount])}")
                print(f"    Names: {list(c.co_names)}")
                print(f"    Strings:")
                for j, const in enumerate(c.co_consts):
                    if isinstance(const, str) and len(const) < 100:
                        print(f"      [{j}] \"{const}\"")
                    elif isinstance(const, str):
                        print(f"      [{j}] str({len(const)})")
                    elif isinstance(const, CodeType):
                        print(f"      [{j}] <{const.co_name}>")
        
        break
