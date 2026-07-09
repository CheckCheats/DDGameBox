import struct

with open(r'D:\DDGameBox\地道游戏盒V14.exe', 'rb') as f:
    data = f.read()

print('File size:', len(data))

# Look for common PyInstaller markers
for marker_name, marker in [
    ('CArchive', b'CB\x00\x00'),
    ('MEIFooter', b'MEI\x0d\x0a'),
    ('PKZIP', b'PK\x03\x04'),
    ('PYZ', b'PYZ\x00'),
    ('PYZ20', b'PYZ\x20'),
]:
    idx = data.find(marker)
    if idx >= 0:
        print(f'{marker_name} at 0x{idx:x} ({idx})')
    else:
        print(f'{marker_name} not found')

# Look at last 400 bytes
print('\n--- Last 400 bytes hex dump ---')
for i in range(max(0, len(data)-400), len(data)):
    c = chr(data[i]) if 32 <= data[i] < 127 else '.'
    print(f'{data[i]:02x}', end='')
    if (i - max(0, len(data)-400) + 1) % 32 == 0:
        print(f'  |{c}', end='\n')
print()

# Find all 'MEI' occurrences
print('\nMEI occurrences:')
pos = 0
while True:
    pos = data.find(b'MEI', pos)
    if pos < 0:
        break
    print(f'  0x{pos:x} (file offset {pos}): ', end='')
    context = data[pos:pos+24]
    print(context.hex())
    pos += 1
