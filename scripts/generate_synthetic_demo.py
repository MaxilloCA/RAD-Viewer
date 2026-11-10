"""Generate deterministic mathematical test patterns, never patient-derived images."""
from pathlib import Path
import struct
root = Path(__file__).resolve().parents[1] / 'fixtures' / 'synthetic'
root.mkdir(parents=True, exist_ok=True)
def element(group, tag, vr, value):
    if len(value) % 2: value += b'\0' if vr == b'UI' else b' '
    header = struct.pack('<HH',group,tag)+vr
    return header + (b'\0\0'+struct.pack('<I',len(value)) if vr in [b'OW',b'OB'] else struct.pack('<H',len(value))) + value
for number in range(1,6):
    data = bytearray(128)+b'DICM'
    meta = element(2,16,b'UI',b'1.2.840.10008.1.2.1')
    data += element(2,0,b'UL',struct.pack('<I',len(meta))) + meta
    data += element(8,0x20,b'DA',f'2000010{number}'.encode())
    for tag,value in [(2,1),(16,64),(17,64),(256,16),(257,12),(258,11),(259,0)]:
        data += element(40,tag,b'US',struct.pack('<H',value))
    data += element(40,4,b'CS',b'MONOCHROME2')
    pixels = b''.join(struct.pack('<H',(x*37+y*23+number*101)%4096) for y in range(64) for x in range(64))
    data += element(0x7fe0,16,b'OW',pixels)
    (root/f'Radiograph-{number:02}.dcm').write_bytes(data)
(root/'PatientInfo.xml').write_text('<trophy><patient><parameter key="first_name" value="Synthetic"/><parameter key="last_name" value="Sample"/></patient></trophy>',encoding='utf-8')
