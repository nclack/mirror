# Mirror

## Description

A utility to monitor a directory and copy any added files/directories to
another directory; to mirror one directory to another.

The added twist is that every so often, copied files will be
queried to make sure they are consistent with the files added to the source
directory.  If consistency is found the original file will be deleted.

This should be useful for copying files as they are generated from one
filesystem to another over a somewhat unreliable connection.

## Usage

Requires [node.js][1].
   
   node mirror.js <src> <dst>
   
[1]: http://nodejs.org/

## Notes

*  There are various setable time constants that determine how often things are polled.
   These are set at the top of the mirror.js script.
   
*  There are two ways of checking for consistency: md5 hash of the contents, and file size.
   Currently, file size is used since this minimizes bandwidth overhead.
   The md5 checker is still inside mirror.js, so if you want to switch back it's possible.
