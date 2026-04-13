#!/bin/sh
# Heavily inspired by IPFS and Dino install script
# Keep this script as simple as possible for auditability
set -e

case $(uname -sm) in
	"Darwin x86_64") suffix="darwin-x64" ;;
	"Darwin arm64") suffix="darwin-arm64" ;;
	"Linux aarch64") suffix="linux-arm64" ;;
  "Linux x86_64") suffix="linux-x64" ;;
	*) suffix="no-file-name" ;;
	esac
bitsocial_compressed_file_name="bitsocial_${suffix}.tar.gz"
VERSION=${1:-latest}
# Construct URI based on version
if [ "$VERSION" = "latest" ]; then
    bitsocial_uri="https://github.com/bitsocialnet/bitsocial-cli/releases/latest/download/${bitsocial_compressed_file_name}"
else
    bitsocial_uri="https://github.com/bitsocialnet/bitsocial-cli/releases/download/v${VERSION}/${bitsocial_compressed_file_name}"
fi
echo "Downloading bitsocial-cli, version: ${VERSION}"
curl --fail --location --progress-bar --output "$bitsocial_compressed_file_name" "$bitsocial_uri"
BITSOCIAL_INSTALL_DIR="$HOME/.bitsocial_install_files"
rm -rf "$BITSOCIAL_INSTALL_DIR"
mkdir -p "$BITSOCIAL_INSTALL_DIR"

tar -xzf $bitsocial_compressed_file_name --directory "$BITSOCIAL_INSTALL_DIR"
echo "Extracted Bitsocial install files to $BITSOCIAL_INSTALL_DIR"
echo "Make sure not to delete this directory"

bitsocial_bin_path=$(eval echo "$BITSOCIAL_INSTALL_DIR/bitsocial/bin/bitsocial") # Make sure it's expanded
binpaths="$HOME/.local/bin /usr/local/bin /usr/bin"

# This variable contains a nonzero length string in case the script fails
# because of missing write permissions.
is_write_perm_missing=""

for system_bin_path_dir in $binpaths; do
  # Expand the $HOME variable.
  system_bitsocial_bin_path=$(eval echo "$system_bin_path_dir/bitsocial")
  mkdir -p "$system_bin_path_dir"
  if ln -sf "$bitsocial_bin_path" "$system_bitsocial_bin_path" ; then
    echo "Bitsocial was installed successfully to $system_bitsocial_bin_path"
	echo "Run 'bitsocial --help' to get started"
	echo "Need help? Join our community"

  rm "$bitsocial_compressed_file_name"

  exit 0
  else
    if [ -d "$system_bin_path_dir" ] && [ ! -w "$system_bin_path_dir" ]; then
      is_write_perm_missing=1
    fi
  fi
done

echo "We cannot install $system_bin_path_dir in one of the directories $binpaths"

if [ -n "$is_write_perm_missing" ]; then
  echo "It seems that we do not have the necessary write permissions."
  echo "Perhaps try running this script as a privileged user:"
  echo
  echo "    sudo $0"
  echo
fi

exit 1
