# Quick Start - 5 Minutes

## 1. Setup (2 minutes)

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your Gemini API key
# GEMINI_API_KEY=your_key_here
```

## 2. Run Initial Learning (3 minutes)

```bash
npm run learn
```

This will:
✓ Learn website behavior  
✓ Capture 10 PDF pages  
✓ Extract tender data  
✓ Ask you to validate results  

When prompted:
- Type **`y`** to accept extraction
- Type **`edit`** to manually correct
- Type **`n`** to skip

## 3. Check Accuracy

```bash
npm run validate
```

This shows your current extraction accuracy.

## 4. Improve (If <95% accuracy)

```bash
npm run train
```

This automatically:
- Identifies failed extractions
- Generates better Gemini prompt
- Re-extracts with improvements
- Shows accuracy increase

**Repeat steps 3-4** until you reach 95%+ accuracy.

## 5. View Results

Check extraction results:
```bash
cat training_data/report.json
```

View extracted tenders:
```bash
ls training_data/examples/  # All extracted tenders
```

## File Structure After Running

```
TenderMY/
├── training_data/
│   ├── examples/         ← Individual extractions
│   ├── validations/      ← Your manual corrections
│   ├── report.json       ← Accuracy report
│   └── metrics.json      ← Performance metrics
│
├── storage/
│   ├── pdfs/            ← Captured PDFs
│   └── screenshots/     ← Visual references
│
├── logs/
│   ├── error.log
│   └── combined.log
│
└── src/
    ├── learn.ts         ← Main learning script
    ├── train.ts         ← Training improvement
    └── validate.ts      ← Analysis & metrics
```

## Commands

| Command | Does |
|---------|------|
| `npm run learn` | Learn website + capture PDFs + extract data |
| `npm run validate` | Show accuracy + error analysis |
| `npm run train` | Improve extraction accuracy |
| `npm run build` | Compile TypeScript |

## Expected Results

**After Run 1 (learn):**
- 150-200 tenders extracted
- ~90-93% confidence on average

**After Validation:**
- You mark correct/incorrect
- Shows error patterns

**After Run 2 (train):**
- Better prompt generated
- 94-96% accuracy

**After Run 3 (train again):**
- 96-98%+ accuracy
- Ready for production!

## Why This Works

1. **PDF-based** - No HTML parsing mess
2. **Gemini Vision** - Handles OCR + extraction
3. **Iterative** - Each run improves accuracy
4. **Manual feedback** - You teach the system

## Troubleshooting

**"GEMINI_API_KEY not provided"**
- Edit `.env` and add your API key

**"No table found"**
- Website uses JavaScript, system waits 2s (normal)

**Low accuracy (<90%)**
- Validate more examples (at least 50)
- Run `npm run train` to improve

**Want to process more pages?**
- Edit `.env`: change `BATCH_SIZE=10` to `BATCH_SIZE=30`
- Run `npm run learn` again

## Next: Production

Once you have 95%+ accuracy:

1. Process all 45+ pages:
   - Change `BATCH_SIZE` in `.env` to match total pages
   - Run `npm run learn`

2. Export to your database:
   - Tenders are in `training_data/examples/`
   - Each is a validated JSON file
   - Import into your PostgreSQL/MongoDB

3. Auto-update daily:
   - Set up cron job to run `npm run learn` daily
   - System adds new tenders automatically

## Example Session

```bash
# Terminal 1: Initial learning
$ npm run learn
[INFO] Learning website...
[INFO] Captured 10 PDFs
[INFO] Extracting with Gemini...
[INFO] Found 150 tenders

MANUAL VALIDATION
--- Example 1 of 5 ---
EXTRACTED: {bil: 1, tarikh: "2024-07-03", kod_bidang: "010302", ...}
Is this correct? (y/n/edit): y

... (answer 4 more) ...

# Terminal 2: Check accuracy
$ npm run validate
✓ Perfect Extractions: 47/50 (94%)
Field Error Rates: kod_bidang 4% errors

# Terminal 3: Improve
$ npm run train
[INFO] Analyzing failures...
[INFO] Generated improved prompt
[INFO] Accuracy: 94% → 98%
✓ Target achieved!

# You're done!
# All tenders in training_data/examples/
# Import into your website database
```

**Questions? Check LEARNING_GUIDE.md for full documentation.**
