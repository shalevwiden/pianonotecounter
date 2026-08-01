# Git Commit Editor (Cursor vs VS Code)

When Git needs you to write a commit message, it opens whatever editor is configured as your **Git editor** (`core.editor`).

## The Problem

If you run:

```bash
git config --global core.editor "cursor --wait"
```

then **every Git repository** on your machine will open Cursor.

If you instead run:

```bash
git config --global core.editor "code --wait"
```

then **every Git repository** will open VS Code.

Whichever command you run **last** becomes the global default.

---

## Option 1: Set the Editor Per Repository (Recommended)

If you use some projects in Cursor and others in VS Code, configure the editor **locally** instead of globally.

### Cursor

```bash
git config core.editor "cursor --wait"
```

### VS Code

```bash
git config core.editor "code --wait"
```

Notice there is **no `--global`**.

This saves the setting inside that repository's `.git/config` file, allowing different projects to use different editors.

---

## Option 2: Change the Global Editor

If you only use one editor at a time, you can change the global editor whenever you switch.

### Cursor

```bash
git config --global core.editor "cursor --wait"
```

### VS Code

```bash
git config --global core.editor "code --wait"
```

---

## Why Git Can't Automatically Pick the Right Editor

Git does **not** know whether you launched a commit from Cursor or VS Code.

It only checks the configured `core.editor` value and launches that program.

Because of this, Git cannot automatically do:

- Cursor → open Cursor
- VS Code → open VS Code

unless you configure the editor **per repository** or manually switch the global setting.

---

## Check Your Current Editor

```bash
git config --global --get core.editor
```

Check the local (repository-specific) editor:

```bash
git config --get core.editor
```

If the local setting exists, it overrides the global setting.
