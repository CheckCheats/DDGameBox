import struct, zlib, os

with open(r'D:\DDGameBox\地道游戏盒V14.exe', 'rb') as f:
    data = f.read()

# PyInstaller 5+ footer format at the end:
# Magic: b'MEI\x0c\x0b\x0a\x0b\x0e' (7 bytes)
# Then: struct (some fields)
# Then TOC entries

# Find the MEI magic marker at the end
footer_magic = b'MEI\x0c\x0b\x0a\x0b\x0e'
last_pos = data.rfind(footer_magic)
print(f'Footer magic at 0x{last_pos:x} ({last_pos})')

if last_pos > 0:
    # Read from footer magic to end
    footer_data = data[last_pos:]
    print(f'Footer data size: {len(footer_data)}')
    print(f'Footer hex: {footer_data[:80].hex()}')
    
    # PyInstaller TOC format:
    # After magic (7 bytes), there might be some fields
    # TOC entries: for each entry:
    #   struct (typecode, name_len, name, ...)
    
    toc_offset = last_pos + 7
    # Skip some bytes
    print(f'\nTOC start at offset 7 from footer:')
    
    # Parse TOC entries
    # Format: name\0type\0 (compressed) or struct-based
    offset = 7
    entries = []
    while offset < len(footer_data):
        # Try to find null-terminated name
        try:
            # TOC entry: typecode (1 byte), name length (packed), name, additional data
            typecode = footer_data[offset]
            if typecode == 0:
                break
            # Name length varint or fixed
            name_start = offset + 1
            name_end = footer_data.find(b'\x00', name_start)
            if name_end < 0:
                break
            name = footer_data[name_start:name_end].decode('utf-8', errors='replace')
            offset = name_end + 1
            
            # typecode interpretation
            type_names = {0: 'EXTENSION', 1: 'PYSOURCE', 2: 'PYCOMPILED', 3: 'DATA', 4: 'OPTION', 5: 'DEPENDENCY', 6: 'BINARY', 7: 'ZIPDATA', 8: 'PYZ', 9: 'CONTAINER'}
            tn = type_names.get(typecode, f'UNKNOWN({typecode})')
            
            entries.append((typecode, name))
            if len(entries) <= 30 or 'steam' in name.lower() or 'game' in name.lower() or 'main' in name.lower() or 'app' in name.lower():
                print(f'  [{typecode}] {name}')
            
            if len(entries) > 500:
                print(f'... ({len(entries)} entries total, stopping)')
                break
        except:
            break
    
    print(f'\nTotal TOC entries parsed: {len(entries)}')
    
    # Show unique typecodes
    types = set(e[0] for e in entries)
    print(f'Typecodes: {types}')

# Also: look for PYZ data in the middle of the file
# PYZ starts with b'PYZ\x00'
pyz_pos = data.find(b'PYZ\x00')
print(f'\nPYZ at 0x{pyz_pos:x} ({pyz_pos})')
if pyz_pos > 0:
    # Try to read PYZ header
    # PYZ = struct {magic(4), unused(8), toc_offset(8), ...} + compressed data
    header = data[pyz_pos:pyz_pos+32]
    print(f'PYZ header: {header.hex()}')
    
    # PYZ is followed by zlib compressed data
    # Try to find the zlib magic header
    zb_pos = data.find(b'\x78\x9c', pyz_pos)
    if zb_pos > 0 and zb_pos - pyz_pos < 100:
        print(f'zlib compressed data at 0x{zb_pos:x} ({zb_pos})')
        print(f'PYZ header size: {zb_pos - pyz_pos}')
        
        # Try to decompress
        try:
            decompressed = zlib.decompress(data[zb_pos:zb_pos+100000])
            print(f'Decompressed size: {len(decompressed)}')
            # Look for Python module names in decompressed data
            text = decompressed.decode('utf-8', errors='replace')
            for line in text.split('\n')[:30]:
                print(f'  {line}')
        except Exception as e:
            print(f'Failed to decompress: {e}')
