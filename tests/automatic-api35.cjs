'use strict';
const path=require('node:path');
process.env.ANDROID_SERIAL='emulator-5574';process.env.COURSE_OWNED_API35='1';process.env.COURSE_REPORT_NAME='api35-native-wrapper-results.json';process.env.COURSE_NATIVE_LOG='api35-native-results.txt';process.env.COURSE_SUBDIR='api35';
require('./course-agenda-fix-ui.cjs')(async h=>{h.android('install','--no-incremental','-r',path.join(h.root,'dist/每日学习-v1.6.7-test.apk'));h.nativeCases();});
