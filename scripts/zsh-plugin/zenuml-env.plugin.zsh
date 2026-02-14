# ZenUML Environment Plugin for Zsh
# Shows current app name in terminal prompt like: [dia]
#
# Usage: Source once to auto-register with Oh My Zsh:
#   source /path/to/confluence-cloud-23/scripts/zsh-plugin/zenuml-env.plugin.zsh
#
# The plugin auto-symlinks to ~/.oh-my-zsh/custom/ for future terminals.
#
# Add $ZENUML_APP to your PROMPT or RPROMPT, e.g.:
#   PROMPT='$ZENUML_APP %~ %# '

# Capture script path at top level (before any functions)
_ZENUML_PLUGIN_PATH="${0:A}"

# Function to get app name from .env.forge
_zenuml_get_app() {
  [[ ! -f ".env.forge" ]] && return

  local app_id=$(grep "^APP_ID=" .env.forge 2>/dev/null | cut -d'=' -f2)
  [[ -z "$app_id" ]] && return

  local app_name
  case "$app_id" in
    d9e4002b-120b-426b-834b-402a4a5adce7) app_name="full" ;;
    8ad26115-211f-4216-971b-0540f606303d) app_name="lite" ;;
    01ede8b1-4e88-451a-b9ef-89eeef93afaf) app_name="dia" ;;
    *) return ;;
  esac

  echo "%{$fg_bold[blue]%}[%{$fg[red]%}$app_name%{$fg_bold[blue]%}]%{$reset_color%}"
}

# Update ZENUML_APP before each prompt
_zenuml_precmd() {
  ZENUML_APP=$(_zenuml_get_app)
}

# Hook into prompt (runs before each prompt display)
autoload -Uz add-zsh-hook
add-zsh-hook precmd _zenuml_precmd

# Initialize on load
ZENUML_APP=$(_zenuml_get_app)

# Auto-register: symlink to Oh My Zsh custom dir if available
_zenuml_register() {
  local omz_custom="$HOME/.oh-my-zsh/custom"
  local link="$omz_custom/zenuml-env.zsh"

  if [[ -d "$omz_custom" && ! -e "$link" ]]; then
    ln -s "$_ZENUML_PLUGIN_PATH" "$link"
    echo "ZenUML plugin registered at $link. Restart terminal to auto-load."
  fi
}
_zenuml_register
