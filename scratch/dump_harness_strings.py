import re

def main():
    binary_path = "/tmp/antigravity-extracted/google/antigravity/bin/localharness"
    with open(binary_path, "rb") as f:
        data = f.read()

    # Find printable ASCII strings of length >= 20
    strings = []
    current = bytearray()
    for b in data:
        if 32 <= b <= 126 or b in (10, 13):
            current.append(b)
        else:
            if len(current) >= 20:
                try:
                    s = current.decode('utf-8')
                    strings.append(s)
                except UnicodeDecodeError:
                    pass
            current = bytearray()
            
    # Search for raw byte occurrences of system instructions
    indices = [m.start() for m in re.finditer(b"You are Antigravity", data)]
    for idx in indices:
        print(f"--- MATCH AT INDEX {idx} ---")
        chunk = data[idx-200 : idx+5000]
        # Replace non-printable bytes (except newline/tab/carriage return) with spaces or escape them
        cleaned = []
        for b in chunk:
            if 32 <= b <= 126 or b in (10, 13):
                cleaned.append(chr(b))
            elif b == 0:
                cleaned.append("\n") # convert null bytes to newlines to see splits
            else:
                cleaned.append(f"\\x{b:02x}")
        print("".join(cleaned))
        print("-----------------------------")

if __name__ == "__main__":
    main()
