/* mirror.js
   by Nathan Clack
   Copyright (C) 2013, Howard Hughes Medical Institute, All Rights Reserved.

 [ ] ? what happens when you have thousands of subdirectories
       will it scale
 [ ] might need a list of files to ignore (e.g. .DS_Store)
 [x] when a new directory comes in should see if it contains files and do onfile on those.
     It looks like when you copy a directory hierarchy it comes in already poplulated?
     [x] May need to have a delay before file handling as well to allow writing to finish.

 [ ] what to do when hashes are different
     ? reattempt copy
*/

var fs=require('fs'),
    path=require('path'),
    crypto=require('crypto'),
    util=require('util'),
    mkdirp=require('mkdirp');

var outstanding=0;
function LOG() {
  console.log( util.format('[%d] ',outstanding) +
               util.format.apply(null,arguments));
}

/* Test */
WAIT_FOR_FILE_MS     = 5*1000; // 5 sec
WAIT_FOR_TRANSFER_MS =10*1000; // 5 min
/**/

/* Production
WAIT_FOR_FILE_MS     =  1*60*1000; // 1  min
WAIT_FOR_TRANSFER_MS = 10*60*1000; // 10 min
/**/

// from: http://stackoverflow.com/questions/11293857/fastest-way-to-copy-file-in-node-js
function copyFile(source, target, cb) {
  var cbCalled = false;

  var wr =  fs.createWriteStream(target)
              .on("error", function(err) {done(err);})
              .on("close", function(ex)  {done();});
  var rd =  fs.createReadStream(source)
              .on("error", function(err) {done(err);})
              .pipe(wr);

  function done(err) {
    if (!cbCalled) {
      cb(err);
      cbCalled = true;
    }
  }
}

var hashfile=function(filename,cb) {
/* cb - function(hash)
 *    - called when hash has finished computing
 */
  var h = crypto.createHash('sha1');
  fs.ReadStream(filename)
    .on('error',function(err) { LOG("Problem hashing ",filename); cb(0); })
    .on('data', function(d)   { h.update(d); })
    .on('end', function()     { cb(h.digest('hex')); });
}

var HashComparison=function(cb)
{ var ctx={};
  var ha=undefined;
  var hb=undefined;
  var maybecheck=function() {
    if(ha && hb) cb(ha==hb);
  }
  ctx.hashA=function(filename) {
    hashfile(filename,function(hash){ ha=hash; maybecheck(); });
    return ctx;
  }
  ctx.hashB=function(filename) {
    hashfile(filename,function(hash){ hb=hash; maybecheck(); });
    return ctx;
  }
  return ctx;
}



var copy_and_check=function(dst,root,dt_ms,cb) {
/* cb - function(src,dst,issame)
      - called after copying src to dst, waiting, and checking hashes.
 */
  return function onfile(src) {
    var target=path.join(dst,path.relative(root,src));
    var hc=HashComparison(function(issame) { cb(src,dst,issame); });
    outstanding++;
    LOG(target,'<--',src,dt_ms);
    mkdirp(path.dirname(target),function(err){
      if(err) LOG(err);
      LOG('COPYING ', src)
      copyFile(src,target,function(err){
        if(err) LOG(err);
        else{
          hc.hashA(src);
          setTimeout(function(){hc.hashB(target);},dt_ms);
        }
      });
    });

  }
}

var onwatch = function(parent,onfile) {
  /*
   * parent - the directory being watched.  Should be the path to a directory.
   * onfile - callback to deal with a file that has been added to a watched
   *          directory.  Called at file creation and modification,
   *          but not deletion.
   *          Should have the form:"
   *            onfile(filename)
   *            - filename is the path to the new file
   */
  LOG('Watching ',parent)
  var handle_path = function(s) {
    fs.stat(s,function(err,stats){
      if(err) {LOG(err)} // usually ENOENT from deleted files/directories
      else {
        if(stats.isDirectory()) {ondir(s);}
        else                    {onfile(s);}
      }
    })
  }
  var ondir=function(p) {
    setTimeout(function() { // wait a long time for directory changes to complete.
      fs.readdir(p,function(err,files) {
        if(err) LOG(err);
        files.forEach(function(e) { handle_path(path.join(p,e)); });
      });
    },WAIT_FOR_FILE_MS);
  }
  return function(e,filename) { // the event is not super reliable afaict (always rename)
      if (filename)
        handle_path( path.join(parent,filename) ); // path to the source e.g test/text.txt
    }
}

var onsame = function(src,dst,issame){
  if(issame) {
    outstanding--;
    LOG('Same: Deleting ', src);
    fs.unlink(src,function(err) {if(err) LOG(err);});
  } else {
    LOG('!!! DIFFERENT: ',src, 'and ', dst);
  }
}
var main = function(src,dst) {
  fs.watch(src,onwatch(src, copy_and_check(dst,src,WAIT_FOR_TRANSFER_MS,onsame)));
}

main(process.argv[2],process.argv[3])
