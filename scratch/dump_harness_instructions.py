import re

def main():
    binary_path = "/tmp/antigravity-extracted/google/antigravity/bin/localharness"
    with open(binary_path, "rb") as f:
        data = f.read()

    # Find all strings of length >= 10 containing letters and markdown
    # let's decode everything and find all contiguous ASCII chunks
    chunks = []
    current = bytearray()
    for b in data:
        if 32 <= b <= 126 or b in (10, 13):
            current.append(b)
        else:
            if len(current) >= 30:
                try:
                    s = current.decode('utf-8')
                    chunks.append(s)
                except UnicodeDecodeError:
                    pass
            current = bytearray()

    # Look for instructions-related keywords
    keywords = ["You are Antigravity", "Deepmind", "Advanced Agentic Coding", "## ", "Guidelines:", "Mandates:"]
    seen = set()
    for chunk in chunks:
        for kw in keywords:
            if kw in chunk:
                # print chunk and avoid duplicates
                normalized = chunk.strip()
                if normalized not in seen:
                    seen.add(normalized)
                    print(f"=== MATCH ({kw}) ===")
                    print(normalized)
                    print("====================\n")

if __name__ == "__main__":
    main()
