/* 
 * This file is part of the corpus-creation distribution 
 * (https://github.com/vicfer-tfg/corpus-creation).

 * Copyright (c) 2019 
 * Vicent Ahuir Esteve (viahes@eui.upv.es)
 * and 
 * Fernando Alcina Sanchis (feralsa5@inf.upv.es).
 * 
 * This program is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU General Public License as published by  
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License 
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const FileMonitor = require('file-state-monitor').FileMonitor;
const ContentHashState = require('file-state-monitor').ContentHashState;
const fs = require('fs');
const request = require('request');
const MongoClient = require('mongodb').MongoClient;
const DB_URL = "mongodb://mongodb-04:27017,mongodb-03:27017,mongodb-02:27017,mongodb-01:27017/noticias?replicaSet=replica01"; 
const TEMP_FILE = "__processing__";

var db;

// The state changes of the files will be stored in the below file
let monitor = new FileMonitor(ContentHashState);
monitor.monitorPath('./urls_to_process/');

// URL del parser service
const URL_PS = 'http://localhost:3000/get_news';

var files_queue = [];

if (!fs.existsSync('./urls_processed/')) {
  fs.mkdirSync('./urls_processed/');
}

function shuffle(a) {
  var j, x, i;
  for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      x = a[i];
      a[i] = a[j];
      a[j] = x;
  }
  return a;
}

function existsURL(url, collection, callback) {
  var query = { url: url };

  db.collection(collection).find(query).toArray(
    function(err, result) {
      if (err) { console.warn(err); callback(-1); }
      else { callback(result.length); }
    }
  ); 
}

function processURL(url, conf, collection, callback) {
  existsURL(url, collection, function(res) {
    if (res < 0) { callback(-2); }
    else if (res > 0) { callback(-1); }
    else { 
      existsURL(url, 'nocontent', function(res) {
        if (res < 0) { callback(-2); }
        else if(res > 0) { callback(-10); }
        else {
          existsURL(url, 'errors', function(res) {
            if (res < 0) { callback(-2); }
            else if(res > 0) { callback(-11); }
            else {
              var url_req = `${URL_PS}?url=${url}&conf=${conf}`;

              request(url_req,  function (error, response, body) {
                if (error && !response) {
                  callback(-3, error);

                } else if(response.statusCode != 200) {
                  callback(response.statusCode, error);

                } else {
                  const json = JSON.parse(body);

                  if(json.content == '') {
                    callback(0);

                  } else {
                    callback(200, json);
                  }
                }
              });
            }
          });
        }
      });
    }
  });
}

function processURLs(file_path, callback) {
  const filename = file_path.substring(file_path.lastIndexOf('/') + 1);
  const ofile_path = `./urls_processed/${
    file_path.substring(file_path.lastIndexOf('/') + 1)}`;

  const jo_file_path = `./urls_processed/${
    file_path.substring(file_path.lastIndexOf('/') + 1)}.out`;

  if (fs.existsSync(jo_file_path)) {
    fs.unlinkSync(jo_file_path);
  }

  console.log(`Processing: ${filename}`);

  var news = fs.readFileSync(file_path, 'utf8').split('\n');  

  for (var i = 0; i < news.length; ++i) {
    if (news[i].trim().length == 0 || news[i].startsWith('#')) continue;

    const line = news[i].split('\t');
    if (line.length < 3) continue;

    news[i] = new Object();
    news[i].url = line[0];
    news[i].confs = line[1].split(',');
    //console.log(news[i].confs);
    for (var j = 0; j < news[i].confs.length; ++j) {
      news[i].confs[j].trim();
    }
    news[i].collection = line[2].trim();
  }

  // Filtramos lo que no son noticias (lineas en blanco)
  news = news.filter(item => item.hasOwnProperty("url"));
  //console.log(news);

  const urlCallback = (news, ti, index, cindex) => {
    return function(status, json) {
      //console.log(`${ti}\t ${index}\t ${cindex}`);
      next = true;

      if (status == 200) {
        fs.appendFileSync(TEMP_FILE, `[OK] ${news[index].url}\n`, 'utf-8');
        fs.appendFileSync(jo_file_path, JSON.stringify(json) + '\n\n', 'utf-8');

        json.config = news[index].confs[cindex];

        db.collection(news[index].collection).insertOne(
          json, function(err, res) { if(err) { console.warn(err); } }
        );

      } else if (status > 0 && ti < 5) {
        if (status == 523) {
          const url = news[index].url;
          const conf = news[index].confs[cindex];
          const collection = news[index].collection;

          processURL(url, conf, collection, 
            urlCallback(news, ti + 1, index, cindex));

          next = false;

        } else {
          fs.appendFileSync(TEMP_FILE,
            `[KO:${status}] ${news[index].url}\n`, 'utf-8');
          db.collection('errors').insertOne(
            { 
              url: news[index].url,
              collection: news[index].collection,
              status: status,
              error: json,
              config: news[index].confs[cindex]
            }, 
            function(err, res) { if(err) { console.warn(err); } }
          );
        }

      } else if (status == 0 || status == -10) {
        if (status == -10 || cindex == news[index].confs.length - 1) {
          fs.appendFileSync(TEMP_FILE,`[NC] ${news[index].url}\n`, 'utf-8');

          if (status == 0) {
            db.collection('nocontent').insertOne(
              { 
                url: news[index].url,
                collection: news[index].collection, 
                config: news[index].confs[cindex]
              }, 
              function(err, res) { if(err) { console.warn(err); } }
            );
          }

        } else {
          const url = news[index].url;
          const conf = news[index].confs[cindex + 1];
          const collection = news[index].collection;

          processURL(url, conf, collection,
            urlCallback(news, ti, index, cindex + 1));

          next = false;
        }

      } else if (status == -1) {
        fs.appendFileSync(TEMP_FILE,`[DP] ${news[index].url}\n`, 'utf-8');

      } else if (status == -2) {
        fs.appendFileSync(TEMP_FILE,`[EC] ${news[index].url}\n`, 'utf-8');

      } else {
        fs.appendFileSync(TEMP_FILE,`[ERR] ${news[index].url}\n`, 'utf-8');

        if (status != -11) {
          db.collection('errors').insertOne(
            { 
              url: news[index].url,
              collection: news[index].collection,
              error: json,
              status: 598,
              config: news[index].confs[cindex]
            }, 
            function(err, res) { if(err) { console.warn(err); } }
          );
        }
      }

      // Procesamos la siguiente noticia si procede
      if (next) {
        if (index == news.length - 1) {
          fs.renameSync(TEMP_FILE, ofile_path);
          console.log(`Processed: ${filename}`);

          callback();

        } else {
          const i = index + 1;
          const url = news[i].url;
          const conf = news[i].confs[0];
          const collection = news[index].collection;

          processURL(url, conf, collection, urlCallback(news, 1, i, 0));
        }
      }
    }
  };

  if (news.length > 0) {
    const url = news[0].url;
    const conf = news[0].confs[0];
    const collection = news[0].collection;

    processURL(url, conf, collection, urlCallback(news, 1, 0, 0));

  } else {
    fs.renameSync(ofile_path, '', 'utf-8');
    console.log(`Processed: ${filename}`);

    callback();
  }
}

if (fs.existsSync(TEMP_FILE)) {
  fs.unlinkSync(TEMP_FILE);
}

function checkFolder() {
  //console.log("checking");
   
  let changedFiles = monitor.getChangedFiles();
  const empty = files_queue.length == 0;

  for (var [key, value] of changedFiles.entries()) {
    if (value = 'created') {
      //console.log(key + ' = ' + value);
      var filename = `./urls_processed/${
        key.substring(key.lastIndexOf('/') + 1)}`;

      if (!fs.existsSync(filename)) {
        files_queue.push(key);
      }
    }
  } 

  //files_queue = shuffle(files_queue);

  monitor.update(['./urls_to_process/']);
  setTimeout(checkFolder, 5000);

  if (empty && files_queue.length > 0) {
    const callback = () => {
      if (files_queue.length > 0) {
        processURLs(files_queue.shift(), callback);
      }
    };

    processURLs(files_queue.shift(), callback);
  }
}

//Conexión a mongodb
MongoClient.connect(DB_URL, function(err, client) {
  if (err) throw err;

  console.log("DB connected");
  db = client.db("noticias");

  checkFolder();
});