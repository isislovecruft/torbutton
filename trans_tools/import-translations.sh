#!/bin/bash -e

# This var comes from the TBB locale list.
# XXX: Find some way to keep this, tor-launcher, and Tor Browser in sync
BUNDLE_LOCALES="ar de es fa fr it ko nl pl pt ru tr vi zh-CN"

# XXX: Basque (eu) by request in #10687.
# This is not used for official builds, but should remain 
# so Basque XPIs can be build independently. We can do
# this for other languages too, if anyone requests this
# and translations are available.
BUNDLE_LOCALES="$BUNDLE_LOCALES eu ja sv"

LOCALE_DIR=../src/chrome/locale

# FILEMAP is an array of "localeFile:translationBranch" strings.
FILEMAP=( "aboutDialog.dtd:torbutton-aboutdialogdtd"
          "aboutTor.dtd:abouttor-homepage"
          "aboutTor.properties:torbutton-abouttorproperties"
          "brand.dtd:torbutton-branddtd"
          "brand.properties:torbutton-brandproperties"
          "torbutton.dtd:torbutton-torbuttondtd"
          "torbutton.properties:torbutton-torbuttonproperties"
         )

# Verify that the FILEMAP contains an entry for each Torbutton file.
FILES_ARE_MISSING=0
for DEST_PATH in $LOCALE_DIR/en/*.dtd $LOCALE_DIR/en/*.properties;
do
  IS_FILE_IN_MAP=0
  DEST_FILE=${DEST_PATH##*/}
  for KEYVAL in "${FILEMAP[@]}";
  do
    FILE="${KEYVAL%%:*}"
    if [ $FILE = $DEST_FILE ];
    then
      IS_FILE_IN_MAP=1
      break;
    fi
  done

  if [ $IS_FILE_IN_MAP -eq 0 ];
  then
    echo "Please add $DEST_FILE to FILEMAP." 1>&2
    FILES_ARE_MISSING=1
  fi
done

if [ $FILES_ARE_MISSING -ne 0 ];
then
  exit 1
fi

# Clone or update our translation repo.
if [ -d translation ];
then
  cd translation
  git fetch origin
  cd ..
else
  git clone https://git.torproject.org/translation.git
fi

# Update each translated file for each locale.
echo "Locales: $BUNDLE_LOCALES"
cd translation
for KEYVAL in "${FILEMAP[@]}"; do
  DEST_FILE="${KEYVAL%%:*}"
  BRANCH="${KEYVAL##*:}"
  echo "Updating ${DEST_FILE}..."
  git checkout -q "$BRANCH"
  git merge -q origin/"$BRANCH"
  for i in $BUNDLE_LOCALES;
  do
    UL="`echo $i|tr - _`"
    mkdir -p ../$LOCALE_DIR/$i/
# Some file names are lowercase in Transifex.
    if [ -f $UL/"$DEST_FILE" ]; then
      SRCFILE="$DEST_FILE"
    else
      SRCFILE="`echo $DEST_FILE | tr '[:upper:]' '[:lower:]'`"
    fi
# Use sed to work around a Transifex "double entity" issue.
    sed -e 's/\&amp;brandShortName;/\&brandShortName;/g'			\
        -e 's/\&amp;vendorShortName;/\&vendorShortName;/g'			\
        $UL/"$SRCFILE" > ../$LOCALE_DIR/$i/"$DEST_FILE"
  done
done
