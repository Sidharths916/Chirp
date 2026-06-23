cd ~/chirp

# Initialize git if you haven't already
git init
git add .
git commit -m "chore: initial commit — sprite engine + Tauri shell"

# Add a .gitignore if it's missing
cat > .gitignore << 'EOF'
node_modules/
target/
.env
*.key
dist/
