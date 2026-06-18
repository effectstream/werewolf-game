#!/bin/bash

# Apply patches
echo "🔧 Applying patches..."

# Function to comment out a line at specific line number
comment_line() {
    local file="$1"
    local line_num="$2"
    local comment_text="$3"
    
    if [[ -f "$file" ]]; then
        # Use sed to comment out the line (add // at the beginning)
        sed -i.bak "${line_num}s|^|// |" "$file"
        echo "✅ Commented line $line_num in $file"
    else
        echo "⚠️  Warning: File $file not found"
    fi
}

# Function to replace content in a file
replace_in_file() {
    local file="$1"
    local old_content="$2"
    local new_content="$3"
    
    if [[ -f "$file" ]]; then
        # Create backup first
        cp "$file" "$file.bak"
        
        # Use perl for more reliable string replacement
        # Only escape the search pattern, not the replacement text
        perl -i -pe "s/\Q$old_content\E/$new_content/g" "$file"
        echo "✅ Replaced content in $file"
    else
        echo "⚠️  Warning: File $file not found"
    fi
}

# Patch hardhat compiler.js
for dir in ./node_modules/.deno/hardhat@3.[0-1]*.[0-9]*/ ; do
    file_to_patch="${dir}node_modules/hardhat/dist/src/internal/builtin-plugins/solidity/build-system/compiler/compiler.js"
    echo "Commenting out await stdoutFileHandle.close() in ${file_to_patch}..."
    comment_line "$file_to_patch" 48 "await stdoutFileHandle.close();"
done

# Patch hardhat-utils fs.js 
for dir in ./node_modules/.deno/@nomicfoundation+hardhat-utils@3.[0-1]*.[0-9]*/ ; do
    file_to_patch="${dir}node_modules/@nomicfoundation/hardhat-utils/dist/src/fs.js"
    echo "Commenting out first await fileHandle?.close() in ${file_to_patch}..."
    comment_line "$file_to_patch" 209 "await fileHandle?.close();"
    echo "Commenting out second await fileHandle?.close() in ${file_to_patch}..."
    comment_line "$file_to_patch" 275 "await fileHandle?.close();"
done

cp ./node_modules/.deno/libsodium-wrappers-sumo@0.7.16/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs ./node_modules/.deno/libsodium-wrappers-sumo@0.7.16/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs
echo "✅ Copied libsodium-sumo.mjs to libsodium-wrappers-sumo.mjs"

# Patch @seriousme/opifex socket.ts - catch unhandled async rejections on write/close
for dir in ./node_modules/.deno/@seriousme+opifex@1.11.3*/ ; do
    file_to_patch="${dir}node_modules/@seriousme/opifex/socket/socket.ts"
    if [[ -f "$file_to_patch" ]]; then
        replace_in_file "$file_to_patch" \
            "this.writer.write(data);" \
            "this.writer.write(data).catch(() => {});"
        replace_in_file "$file_to_patch" \
            "this.writer.close();" \
            "this.writer.close().catch(() => {});"
    else
        echo "⚠️  Warning: opifex socket.ts not found at $file_to_patch"
    fi
done

echo "✅ All patches applied successfully"