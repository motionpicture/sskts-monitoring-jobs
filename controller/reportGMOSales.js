"use strict";
/**
 * GMO実売上状況を報告する
 *
 * @ignore
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const sskts = require("@motionpicture/sskts-domain");
const createDebug = require("debug");
const moment = require("moment");
const mongoose = require("mongoose");
const querystring = require("querystring");
const request = require("request-promise-native");
const mongooseConnectionOptions_1 = require("../mongooseConnectionOptions");
mongoose.Promise = global.Promise;
const debug = createDebug('sskts-reportjobs:controller:reportGMOSales');
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        mongoose.connect(process.env.MONGOLAB_URI, mongooseConnectionOptions_1.default);
        yield reportGMOSalesAggregations();
        yield reportScatterChartInAmountAndTranDate();
        mongoose.disconnect();
    });
}
exports.main = main;
/**
 * 時間帯ごとの実売上をプロットしてみる
 * todo 調整
 */
function reportScatterChartInAmountAndTranDate() {
    return __awaiter(this, void 0, void 0, function* () {
        // ここ24時間の実売上をプロットする
        const dateTo = moment();
        // tslint:disable-next-line:no-magic-numbers
        const dateFrom = moment(dateTo).add(-3, 'days');
        const gmoNotificationAdapter = sskts.adapter.gmoNotification(mongoose.connection);
        const gmoNotifications = yield gmoNotificationAdapter.gmoNotificationModel.find({
            job_cd: 'SALES',
            tran_date: {
                // tslint:disable-next-line:no-magic-numbers
                $gte: dateFrom.format('YYYYMMDDHHmmss'),
                $lt: dateTo.format('YYYYMMDDHHmmss')
            }
        }, 'amount tran_date').lean().exec();
        debug('gmoNotifications:', gmoNotifications.length);
        const maxAmount = gmoNotifications.reduce((a, b) => Math.max(a, b.amount), 0);
        debug('maxAmount:', maxAmount);
        // 時間帯x金額帯ごとに集計
        const AMOUNT_UNIT = 1000;
        const prots = {};
        gmoNotifications.forEach((gmoNotification) => {
            // tslint:disable-next-line:no-magic-numbers
            const x = Number(gmoNotification.tran_date.slice(8, 10));
            const y = Math.floor(gmoNotification.amount / AMOUNT_UNIT);
            if (prots[`${x}x${y}`] === undefined) {
                prots[`${x}x${y}`] = {
                    x: x,
                    y: y,
                    size: 0
                };
            }
            prots[`${x}x${y}`].size += 1;
        });
        debug('prots:', prots);
        const sizeMax = Object.keys(prots).reduce((a, b) => Math.max(a, prots[b].size), 0);
        debug('sizeMax:', sizeMax);
        const params = {
            chof: 'png',
            cht: 's',
            chxt: 'x,x,y,y',
            chds: `0,24,0,${Math.floor(maxAmount / AMOUNT_UNIT) + 1}`,
            chxl: '1:|時台|3:|千円台',
            // tslint:disable-next-line:no-magic-numbers
            chxr: `0,0,24,1|2,0,${Math.floor(maxAmount / AMOUNT_UNIT) + 1}`,
            chg: '100,100',
            chd: 't:',
            chls: '5,0,0',
            // chdl: '金額',
            chs: '200x100'
        };
        params.chd += Object.keys(prots).map((key) => prots[key].x).join(',');
        params.chd += '|' + Object.keys(prots).map((key) => prots[key].y).join(',');
        // tslint:disable-next-line:no-magic-numbers
        params.chd += '|' + Object.keys(prots).map((key) => Math.floor(prots[key].size / sizeMax * 50)).join(',');
        // params.chd += gmoNotifications.map((gmoNotification) => Number(gmoNotification.tran_date.slice(8, 10))).join(',');
        // params.chd += '|' + gmoNotifications.map((gmoNotification) => Math.floor(gmoNotification.amount / 100)).join(',');
        debug('params:', params);
        const imageThumbnail = `https://chart.googleapis.com/chart?${querystring.stringify(params)}`;
        let body = yield request.get({
            url: `http://is.gd/create.php?format=simple&format=json&url=${encodeURIComponent(imageThumbnail)}`,
            json: true
        }).promise();
        const imageThumbnailShort = body.shorturl;
        params.chs = '800x300';
        const imageFullsize = `https://chart.googleapis.com/chart?${querystring.stringify(params)}`;
        body = yield request.get({
            url: `http://is.gd/create.php?format=simple&format=json&url=${encodeURIComponent(imageFullsize)}`,
            json: true
        }).promise();
        const imageFullsizeShort = body.shorturl;
        debug('imageFullsizeShort:', imageFullsizeShort);
        yield sskts.service.notification.report2developers(`GMO売上散布図
${dateFrom.format('MM/DD HH:mm:ss')}-${dateTo.format('MM/DD HH:mm:ss')}`, `サンプル数:${gmoNotifications.length}`, imageThumbnailShort, imageFullsizeShort)();
    });
}
function reportGMOSalesAggregations() {
    return __awaiter(this, void 0, void 0, function* () {
        // todo パラメータで期間設定できるようにする？
        // tslint:disable-next-line:no-magic-numbers
        const aggregationUnitTimeInSeconds = 900; // 集計単位時間(秒)
        const numberOfAggregationUnit = 96; // 集計単位数
        const dateNow = moment();
        const dateNowByUnitTime = moment.unix((dateNow.unix() - (dateNow.unix() % aggregationUnitTimeInSeconds)));
        // 集計単位数分の集計を行う
        let aggregations = yield Promise.all(Array.from(Array(numberOfAggregationUnit)).map((__, index) => __awaiter(this, void 0, void 0, function* () {
            debug(index);
            const dateTo = moment.unix((dateNowByUnitTime.unix() - (dateNowByUnitTime.unix() % aggregationUnitTimeInSeconds)))
                .add(index * -aggregationUnitTimeInSeconds, 'seconds').toDate();
            // tslint:disable-next-line:no-magic-numbers
            const dateFrom = moment(dateTo).add(-aggregationUnitTimeInSeconds, 'seconds').toDate();
            debug(dateFrom.toISOString(), dateTo.toISOString());
            const gmoNotificationAdapter = sskts.adapter.gmoNotification(mongoose.connection);
            const gmoSales = yield sskts.service.report.searchGMOSales(dateFrom, dateTo)(gmoNotificationAdapter);
            return {
                dateFrom: dateFrom,
                dateTo: dateTo,
                gmoSales: gmoSales,
                // tslint:disable-next-line:no-magic-numbers
                totalAmount: gmoSales.reduce((a, b) => a + parseInt(b.amount, 10), 0) // 合計金額を算出
            };
        })));
        aggregations = aggregations.reverse();
        debug('aggregations:', aggregations);
        const AMOUNT_UNIT = 100;
        const params = {
            chof: 'png',
            cht: 'ls',
            chxt: 'x,y,y',
            // chds: '0,400',
            chds: 'a',
            chxl: '0:|24時間前|18時間前|12時間前|6時間前|0時間前|2:|百円',
            // chxr: `1,0,400`,
            chg: '25,10',
            chd: 't:',
            chls: '5,0,0',
            // chdl: '金額',
            chs: '300x100'
        };
        params.chd += aggregations.map((agrgegation) => Math.floor(agrgegation.totalAmount / AMOUNT_UNIT)).join(',');
        const imageThumbnail = `https://chart.googleapis.com/chart?${querystring.stringify(params)}`;
        debug('imageThumbnail:', imageThumbnail);
        params.chs = '750x250';
        const imageFullsize = `https://chart.googleapis.com/chart?${querystring.stringify(params)}`;
        const lastAggregation = aggregations[aggregations.length - 1];
        yield sskts.service.notification.report2developers(`GMO売上金額遷移(15分単位)
${moment(aggregations[0].dateFrom).format('MM/DD HH:mm:ss')}-${moment(lastAggregation.dateTo).format('MM/DD HH:mm:ss')}`, '', imageThumbnail, imageFullsize)();
    });
}
