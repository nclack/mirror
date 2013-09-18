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

var outstanding={};
function LOG() {
  console.log( util.format('[%d] ',Object.keys(outstanding).length) +
               util.format.apply(null,arguments));
}

// The history is there just to prevent watching the same file multiple times.
// When a file is written to a watched directory many events get fired.  This
// ensures we respond to just one of those.
var history={} 


/* Timing */
RETRY_MS              = 1*1000; // msec -- The copy may fail if the file is locked for writing, so the copy is retried every so often
WAIT_FOR_TRANSFER_MS  =10*1000; // msec -- Wait a bit before validating the copy
HISTORY_TIMEOUT       =10*1000; // msec -- if an item in the history is older that this timeout, remove it
HISTORY_CLEAN_INTERVAL= 5*1000; // msec -- check the history for stale items every so often
PURGEDIR_TIMEOUT      = 5*1000; // msec -- amount of time to wait after deleting a file before an attempt is made to remove the directory
/**/


// Directory names to ignore
ignore={};
ignore["$RECYCLE.BIN"]=true

// from: http://stackoverflow.com/questions/11293857/fastest-way-to-copy-file-in-node-js
function copyFile(source, target, cb) {
  var cbCalled = false;
  LOG(source,target);
  var wr =  fs.createWriteStream(target)
              .on("error", function(err) {LOG(err); LOG('Retry. ',source); setTimeout(function(){copyFile(source,target,cb);},RETRY_MS); /*done(err);*/})
              .on("close", function(ex)  {done();});
  var rd =  fs.createReadStream(source)
              .on("error", function(err) {
                if(err.code=='EBUSY') { // windows keeps the file locked till its done being written, so retry if busy, until the stream can be opened
                  LOG('Retry. ',source)
                  setTimeout(function(){copyFile(source,target,cb);},RETRY_MS)
                } else { 
                  done(err);
                }
              })
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
    .on('error',function(err) { 
                LOG("Problem hashing ",filename);
                setTimeout(function() {hashfile(filename,cb);},RETRY_MS)/*cb(0);*/
              })
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
    outstanding[src]=true;
    LOG(target,'<--',src,dt_ms);
    function handle_copy() {
      mkdirp(path.dirname(target),function(err){
        if(err && err.code!="OK") {
          LOG(err);
          if(err.code=="ECONNRESET")
            setTimeout(function(){LOG('RETRY', src); handle_copy();},RETRY_MS);
        }
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
    handle_copy();
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
    fs.watch(p,onwatch(p,onfile))
  }
  return function(e,filename) {
      // the event is not super reliable afaict
      // - always rename on osx
      // - on windows, I get rename and change events.
      //   "rename" on create.
      //   "rename" (null) on delete?
      //   "change" as filesystem makes commits, I think.
      //   sometimes I don't see the rename event on creation.  At least when copying a directory.
      
      if (filename) {
        if(!(filename in history)) {
          history[filename]=new Date();
          LOG(e,filename)
          handle_path( path.join(parent,filename) ); // path to the source e.g test/text.txt
        }
      }
    }
}

var onsame = function(src,dst,issame){
  if(issame) {
    delete outstanding[src];
    LOG('Same: Deleting ', src);
    fs.unlink(src,function(err) {if(err) LOG(err);});
  } else {
    LOG('!!! DIFFERENT: ',src, 'and ', dst);
  }
}

var main = function(src,dst) {
  // setup watches for existing subdirs
  fs.readdir(src,function(err,files){
    (files||[]).forEach(function(f) {    
      if(f in ignore) return;
      s=path.join(src,f)
      d=path.join(dst,f)
      fs.stat(s,function(err,stats){
        if(stats && stats.isDirectory()) {
          main(s,d);
        }
      });
    });
  });
  // setup watch for root
  fs.watch(src,onwatch(src, copy_and_check(dst,src,WAIT_FOR_TRANSFER_MS,onsame)));
}

setInterval(function() {
  var cur=new Date();
  LOG('HISTORY CLEANUP: Size = ',Object.keys(history).length);
  for(var k in history)  {
    if((cur-history[k])>HISTORY_TIMEOUT)
      delete history[k];
  }
},HISTORY_CLEAN_INTERVAL) // run every second
main(process.argv[2],process.argv[3])


// exit
/*
var tty = require("tty");

process.openStdin().on("keypress", function(chunk, key) {
  if(key && key.name === "c" && key.ctrl) {
    console.log("bye bye");
    process.exit();
  }
});

tty.setRawMode(true);
*/
process.stdin.resume();//so the program will not close instantly
process.on('exit', function (){
  if(outstanding) {
    LOG("--- REMAINING ---")
    for(var s in outstanding) {
      console.log(s)
    }
  }

});
process.on('SIGINT', function () {
  console.log('Got SIGINT.  Press Control-D to exit.');
});
process.stdin.on("data", function(key) {
  if(key && key==="\u0003") { //key.name === "c" && key.ctrl) {
    LOG("Got Ctrl-C");
    process.exit();
  }  
});
process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);

//node mirror.js e: z:\acquisition