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

const fs = require('fs');
const path = require('path');
const execSync = require('child_process').execSync;

const dir = './news_sites/';
const dir_log = './logs/';

var list_confs = [];
fs.readdirSync(dir).forEach(file => {
	list_confs.push(file)
});

// Creamos la carpeta de log si no existe
if (!fs.existsSync(dir_log)) { fs.mkdirSync(dir_log); }

const date_ini = '2018/01/01';
const date_end = '2019/03/30';

//Funcion para el procesado de configuraciones
function process_configuration(i) {
	const command = `node news_single_urls_capture.js "${
		dir}${list_confs[i]}" "${date_ini}" "${date_end}"`; 

	console.log(command);

	execSync(command, {stdio:[0,1,2]});
} 

for (i in list_confs) {
	process_configuration(i);
}
