'use strict';
const path=require('node:path'),fs=require('node:fs');
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'../app/src/main/AndroidManifest.xml'),'utf8'))[1];
process.env.ANDROID_SERIAL='emulator-5574';process.env.COURSE_OWNED_API35='1';process.env.COURSE_REPORT_NAME='api35-native-wrapper-results.json';process.env.COURSE_NATIVE_LOG='api35-native-results.txt';process.env.COURSE_SUBDIR='api35';
require('./course-agenda-fix-ui.cjs')(async h=>{h.android('install','--no-incremental','-r',path.join(h.root,'dist/每日学习-v'+version+'-test.apk'));h.nativeCases();});
