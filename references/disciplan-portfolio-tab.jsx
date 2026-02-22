import { useState, useMemo } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// Compact lot data: [date, sell_date|0, shares, exec_price, cost_basis, market_value, ann_return%]
const L={
"etrade_brokerage|SCHD":[["12/21/2020",0,31.33,21.08,660.47,839.02,4.7],["06/26/2023",0,0.29,23.61,6.94,7.77,4.9],["09/25/2023",0,0.29,23.71,6.9,7.77,5.2],["12/11/2023",0,0.33,24.16,7.9,8.84,4.8],["03/25/2024",0,0.25,26.39,6.57,6.7,0.8],["07/01/2024",0,0.35,25.88,8.93,9.37,2.1],["09/30/2024",0,0.29,28.1,8.26,7.77,-3.4],["12/16/2024",0,0.31,28.08,8.76,8.3,-4.0],["03/31/2025",0,0.3,27.55,8.32,8.03,-3.2],["06/30/2025",0,0.33,26.45,8.78,8.84,2.0],["09/29/2025",0,0.33,27.13,8.87,8.84,-3.3]],
"etrade_brokerage|VTI":[["03/05/2021","12/28/22",12.0,198.4,2380.8,2292.0,-0.8],["01/04/2022","12/28/22",16.0,243.73,3899.68,3056.0,-5.7],["01/07/2022","12/28/22",4.0,236.5,946.0,764.0,-5.1],["01/25/2022","12/28/22",4.0,218.0,872.0,764.0,-3.2],["02/04/2022","12/28/22",5.0,224.83,1124.15,955.0,-4.0],["05/09/2022","12/28/22",5.0,200.0,1000.0,955.0,-1.2]],
"etrade_brokerage|VTSAX":[["09/25/2020",0,123.0,81.3,9999.98,19592.67,13.3],["12/24/2020",0,0.5,93.66,46.55,79.64,10.9],["03/25/2021",0,0.41,98.19,40.06,65.31,10.4],["06/24/2021",0,0.38,107.16,40.4,60.53,8.9],["09/24/2021",0,0.39,111.66,43.44,62.12,8.4],["12/27/2021",0,0.44,116.71,51.7,70.09,7.8],["03/23/2022",0,0.39,110.44,42.85,62.12,9.8],["06/23/2022",0,0.5,91.1,45.46,79.64,16.5],["09/23/2022",0,0.53,91.29,48.47,84.42,17.8],["12/22/2022",0,0.61,94.0,57.06,97.17,18.2],["03/23/2023",0,0.51,95.1,48.31,81.24,19.4],["04/06/2023",0,151.62,98.93,14999.96,24151.55,18.1],["06/23/2023",0,1.06,105.53,111.65,168.85,16.8],["09/20/2023",0,1.02,105.98,108.21,162.48,18.4],["12/20/2023",0,1.2,113.6,136.43,191.15,16.9],["03/22/2024",0,0.99,125.79,124.41,157.7,13.2],["06/28/2024",0,1.0,130.2,130.46,159.29,13.1],["09/27/2024",0,0.87,137.25,119.68,138.58,11.3],["12/23/2024",0,0.91,143.14,129.83,144.95,9.7],["03/27/2025",0,1.0,135.85,136.26,159.29,19.5],["06/30/2025",0,0.86,148.03,126.71,136.99,12.3],["09/29/2025",0,0.79,159.27,126.14,125.84,0.0]],
"etrade_brokerage|VUG":[["04/06/2023",0,24.0,244.54,5868.96,11481.6,26.4],["06/28/2023",0,0.04,274.72,9.89,19.14,23.4],["09/26/2023",0,0.03,265.88,9.04,14.35,27.8],["12/27/2023",0,0.05,305.87,14.07,23.92,23.2],["03/26/2024",0,0.03,341.82,11.28,14.35,19.4],["07/01/2024",0,0.03,379.66,11.01,14.35,15.2],["09/30/2024",0,0.03,378.97,10.99,14.35,18.4],["12/26/2024",0,0.03,417.42,12.94,14.35,12.7],["03/31/2025",0,0.03,367.27,12.12,14.35,34.9],["07/02/2025",0,0.03,437.14,12.24,14.35,15.5],["10/01/2025",0,0.03,473.46,12.31,14.35,2.8]],
"etrade_brokerage|VXUS":[["09/30/2020","12/28/22",90.0,52.13,4691.7,4638.15,-0.2],["02/25/2021","12/28/22",40.0,62.75,2510.0,2061.4,-3.9],["01/04/2022","12/28/22",62.0,64.23,3982.26,3195.17,-5.2],["01/25/2022","12/28/22",16.0,60.79,972.64,824.56,-4.0],["05/09/2022","12/28/22",10.0,53.0,530.0,515.35,-0.7],["04/10/2023",0,50.0,55.1,2755.0,3710.0,11.0],["06/23/2023",0,0.56,55.08,30.9,41.55,11.9],["09/21/2023",0,0.27,55.5,14.93,20.03,12.8],["12/21/2023",0,0.76,56.88,43.06,56.39,13.1],["03/20/2024",0,0.19,59.43,11.53,14.1,12.3],["06/25/2024",0,0.41,60.63,25.04,30.42,13.1],["09/24/2024",0,0.22,63.44,14.21,16.32,11.9],["12/24/2024",0,0.9,58.78,52.67,66.78,22.5],["03/25/2025",0,0.16,63.63,10.18,11.87,18.7],["06/24/2025",0,0.39,66.68,25.94,28.94,17.9],["09/23/2025",0,0.27,73.09,19.37,20.03,3.8]],
"etrade_ira|BBUS":[["01/27/2020",0,50.0,58.31,2915.5,6015.0,12.7],["09/25/2020",0,0.26,58.87,15.24,31.28,14.2],["12/30/2020",0,0.21,68.57,14.5,25.26,11.6],["03/26/2021",0,0.13,71.87,9.13,15.64,11.1],["06/25/2021",0,0.15,78.39,11.49,18.04,9.6],["09/24/2021",0,0.15,81.33,12.14,18.04,9.3],["12/27/2021",0,0.18,86.44,15.7,21.65,8.3],["03/25/2022",0,0.12,81.61,9.56,14.44,10.5],["06/24/2022",0,0.18,69.54,12.84,21.65,16.2],["09/23/2022",0,0.22,66.17,14.25,26.47,19.2],["12/23/2022",0,0.27,68.17,18.64,32.48,19.7],["03/24/2023",0,0.16,70.17,11.49,19.25,20.4],["06/23/2023",0,0.19,78.17,14.54,22.86,17.6],["09/22/2023",0,0.19,77.98,14.66,22.86,19.7],["12/22/2023",0,0.25,85.1,21.36,30.07,17.4],["03/22/2024",0,0.13,94.33,12.64,15.64,13.6],["06/27/2024",0,0.17,97.87,17.03,20.45,13.4],["09/26/2024",0,0.16,102.7,16.33,19.25,12.0],["12/27/2024",0,0.2,108.16,21.74,24.06,9.8],["03/27/2025",0,0.14,103.43,14.79,16.84,18.4],["06/26/2025",0,0.15,110.0,16.72,18.04,14.9],["09/25/2025",0,0.15,119.68,18.43,18.04,1.3]],
"etrade_ira|QQQ":[["04/14/2020",0,14.0,211.76,2964.64,8455.02,19.6],["10/30/2020",0,0.02,270.65,5.44,12.08,16.3],["12/31/2020",0,0.03,312.91,7.85,18.12,13.7],["02/24/2021",0,4.0,322.65,1290.6,2415.72,13.4],["04/30/2021",0,0.02,339.9,7.1,12.08,12.7],["07/30/2021",0,0.02,364.71,7.18,12.08,11.7],["10/29/2021",0,0.02,382.55,7.5,12.08,11.2],["12/31/2021",0,0.02,399.3,8.9,12.08,10.5],["04/29/2022",0,0.02,321.02,7.86,12.08,18.1],["07/29/2022",0,0.03,313.46,9.56,18.12,20.3],["10/31/2022",0,0.03,276.99,9.42,18.12,26.7],["12/30/2022",0,0.05,263.69,11.95,30.2,30.3],["04/28/2023",0,0.03,319.26,8.62,18.12,25.5],["07/31/2023",0,0.02,384.17,9.22,12.08,19.4],["10/31/2023",0,0.03,338.28,9.81,18.12,28.7],["12/29/2023",0,0.04,411.94,14.83,24.16,19.6],["01/16/2024",0,0.01,396.0,3.96,6.04,22.4],["04/30/2024",0,0.03,421.6,10.54,18.12,22.1],["07/31/2024",0,0.03,452.26,14.02,18.12,20.5],["10/31/2024",0,0.03,499.2,12.48,18.12,15.8],["12/31/2024",0,0.03,514.0,15.42,18.12,15.4],["04/30/2025",0,0.03,472.86,13.24,18.12,35.8],["07/31/2025",0,0.02,547.5,10.95,12.08,19.6]],
"etrade_ira|SCHD":[["12/21/2020",0,106.68,21.08,2248.57,2856.89,4.8],["03/29/2021",0,0.95,24.47,23.12,25.44,1.9],["06/28/2021",0,1.0,25.09,24.99,26.78,1.4],["09/27/2021",0,0.84,25.39,21.25,22.5,1.2],["12/13/2021",0,0.87,25.99,22.61,23.3,0.7],["03/28/2022",0,0.72,26.32,19.03,19.28,0.4],["06/27/2022",0,1.07,24.39,26.05,28.65,2.6],["09/26/2022",0,1.05,22.72,23.79,28.12,5.0],["12/12/2022",0,1.05,25.34,26.53,28.12,1.8],["03/27/2023",0,0.96,23.73,22.71,25.71,4.3],["06/26/2023",0,1.08,23.63,25.52,28.92,4.8],["09/25/2023",0,1.07,23.81,25.36,28.65,5.0],["12/11/2023",0,1.2,24.19,29.03,32.14,4.8],["03/25/2024",0,0.91,26.56,24.14,24.37,0.4],["07/01/2024",0,1.26,25.97,32.8,33.74,1.9],["09/30/2024",0,1.08,28.18,30.35,28.92,-3.6],["12/16/2024",0,1.15,28.08,32.21,30.8,-4.0],["03/31/2025",0,1.11,27.62,30.58,29.73,-3.5],["06/30/2025",0,1.22,26.47,32.27,32.67,1.8],["09/29/2025",0,1.2,27.2,32.61,32.14,-4.0]],
"etrade_ira|VIG":[["12/10/2020",0,18.0,138.19,2487.42,3882.24,9.0],["12/24/2020",0,0.09,138.91,11.96,19.41,8.9],["03/25/2021",0,0.06,143.36,9.28,12.94,8.7],["06/24/2021",0,0.08,152.9,12.25,17.25,7.7],["09/23/2021",0,0.08,158.24,12.75,17.25,7.3],["12/23/2021",0,0.08,169.14,14.16,17.25,6.0],["03/24/2022",0,0.08,160.5,12.76,17.25,7.9],["06/24/2022",0,0.09,145.08,12.84,19.41,11.5],["09/22/2022",0,0.09,141.3,13.27,19.41,13.2],["12/23/2022",0,0.11,151.07,16.21,23.72,12.0],["03/29/2023",0,0.09,150.87,14.05,19.41,13.2],["07/05/2023",0,0.09,162.0,14.58,19.41,11.5],["10/03/2023",0,0.1,153.68,14.6,21.57,15.3],["12/27/2023",0,0.1,169.32,17.44,21.57,12.0],["03/27/2024",0,0.08,179.63,14.73,17.25,10.1],["07/02/2024",0,0.1,182.0,17.29,21.57,11.0],["10/01/2024",0,0.08,196.83,16.14,17.25,6.9],["12/26/2024",0,0.09,197.56,16.99,19.41,8.0],["03/31/2025",0,0.1,192.42,18.28,21.57,13.8],["07/02/2025",0,0.08,205.54,17.06,17.25,8.0],["10/01/2025",0,0.08,212.63,17.01,17.25,3.8]],
"health_equity_hsa|VEMPX":[["03/16/2022",0,3.29,304.23,1000.0,1285.21,6.6],["03/22/2022",0,0.0,311.34,0.93,0.0,6.0],["06/22/2022",0,0.01,243.81,1.46,3.91,13.8],["09/22/2022",0,0.01,246.01,2.95,3.91,14.5],["12/21/2022",0,0.02,251.03,4.27,7.81,15.0],["03/23/2023",0,0.01,249.41,2.74,3.91,16.7],["04/05/2023",0,2.68,254.91,682.14,1046.92,16.0],["06/28/2023",0,0.02,274.62,5.77,7.81,14.3],["09/27/2023",0,0.02,266.13,5.32,7.81,17.4],["12/19/2023",0,0.03,306.9,7.67,11.72,11.8],["02/09/2024",0,2.6,311.82,809.8,1015.66,11.8],["03/22/2024",0,0.02,322.29,7.73,7.81,10.6],["06/28/2024",0,0.03,315.98,9.16,11.72,13.8],["09/27/2024",0,0.02,340.26,8.17,7.81,10.5],["12/23/2024",0,0.03,359.27,9.7,11.72,7.5],["03/04/2025",0,4.44,338.22,1500.01,1734.44,16.3],["03/25/2025",0,0.05,339.07,15.26,19.53,17.1],["06/26/2025",0,0.04,358.38,13.26,15.63,14.3],["09/24/2025",0,0.04,391.74,14.49,15.63,-0.7]],
"health_equity_hsa|VIGIX":[["03/16/2022",0,7.07,141.54,1000.0,1741.2,15.2],["03/22/2022",0,0.01,146.59,1.03,2.46,14.2],["06/22/2022",0,0.01,114.58,1.15,2.46,23.3],["09/22/2022",0,0.01,115.33,1.61,2.46,25.0],["12/21/2022",0,0.02,112.01,1.68,4.93,28.3],["03/22/2023",0,0.01,122.55,1.59,2.46,27.1],["04/05/2023",0,5.39,126.52,682.07,1327.45,26.1],["06/22/2023",0,0.02,143.51,2.58,4.93,22.5],["09/20/2023",0,0.02,143.34,2.44,4.93,25.2],["12/20/2023",0,0.02,158.11,3.79,4.93,22.8],["02/09/2024",0,4.66,173.82,810.0,1147.66,18.8],["03/21/2024",0,0.02,178.07,4.1,4.93,18.5],["06/27/2024",0,0.02,194.16,4.08,4.93,15.6],["09/26/2024",0,0.02,197.86,3.96,4.93,17.0],["12/23/2024",0,0.02,216.58,4.76,4.93,11.8],["03/04/2025",0,7.4,202.6,1500.05,1822.47,22.7],["03/27/2025",0,0.03,195.88,6.27,7.39,29.2],["06/30/2025",0,0.03,225.71,6.32,7.39,14.8]],
"health_equity_hsa|VIIIX":[["03/16/2022",0,2.68,373.55,1000.0,1452.59,9.9],["03/23/2022",0,0.02,377.38,8.68,10.84,9.7],["06/23/2022",0,0.01,321.37,3.54,5.42,15.4],["09/23/2022",0,0.01,312.59,3.75,5.42,17.6],["12/29/2022",0,0.04,322.42,13.22,21.68,18.0],["03/24/2023",0,0.02,331.34,7.29,10.84,18.5],["04/05/2023",0,2.0,341.44,682.2,1084.02,17.5],["06/29/2023",0,0.02,366.92,6.97,10.84,15.9],["09/28/2023",0,0.02,358.86,6.46,10.84,18.8],["12/28/2023",0,0.08,394.57,29.99,43.36,16.0],["02/09/2024",0,1.95,415.16,809.98,1056.92,14.1],["03/25/2024",0,0.04,429.32,17.6,21.68,13.1],["07/01/2024",0,0.03,450.44,11.26,16.26,12.0],["09/30/2024",0,0.02,474.14,10.43,10.84,10.2],["12/31/2024",0,0.1,478.88,45.97,54.2,11.6],["03/04/2025",0,3.18,471.45,1500.15,1723.59,15.7],["03/27/2025",0,0.05,462.57,24.52,27.1,19.4],["06/30/2025",0,0.03,504.32,16.14,16.26,12.1],["09/26/2025",0,0.03,540.03,15.66,16.26,0.9]],
"health_equity_hsa|VSMAX":[["03/16/2022",0,9.9,100.99,1000.0,1201.07,4.8],["03/22/2022",0,0.03,102.53,2.67,3.64,4.4],["06/22/2022",0,0.03,83.38,2.83,3.64,10.8],["09/22/2022",0,0.04,84.92,3.14,4.85,11.0],["12/21/2022",0,0.05,88.61,4.78,6.07,10.5],["03/22/2023",0,0.04,86.47,3.55,4.85,12.3],["04/05/2023",0,7.71,88.51,682.06,935.38,11.6],["06/22/2023",0,0.07,92.57,6.48,8.49,10.7],["09/20/2023",0,0.07,92.14,6.27,8.49,12.1],["12/20/2023",0,0.09,100.16,9.21,10.92,9.3],["02/09/2024",0,7.9,102.55,809.94,958.43,8.7],["03/22/2024",0,0.08,107.36,8.37,9.71,6.6],["06/28/2024",0,0.1,104.6,10.56,12.13,9.5],["09/27/2024",0,0.08,113.58,8.86,9.71,4.9],["12/23/2024",0,0.1,115.91,11.36,12.13,4.0],["03/04/2025",0,13.7,109.47,1499.96,1662.08,11.3],["03/27/2025",0,0.16,108.33,17.55,19.41,13.5],["06/30/2025",0,0.13,113.6,15.11,15.77,10.9],["09/29/2025",0,0.13,121.76,15.59,15.77,-0.9]],
"kraken|ADAUSD":[["05/20/2021",0,500.0,1.72,861.38,325.0,-18.5]],
"kraken|BTCUSD":[["02/24/2021",0,0.01,49779.52,497.8,1085.95,17.0],["02/28/2021",0,0.01,44571.2,445.71,1085.95,19.6],["02/28/2021",0,0.01,44070.4,440.7,1085.95,19.9],["01/24/2022",0,0.01,34054.4,340.54,1085.95,33.0],["01/27/2022",0,0.01,36057.6,360.58,1085.95,31.2],["05/14/2022",0,0.01,29400.0,294.0,1085.95,41.5]],
"kraken|ETHUSD":[["02/23/2021","02/12/2022",0.05,1452.32,72.62,145.23,14.9],["02/23/2021",0,0.65,1452.32,944.01,2586.52,22.4],["05/13/2021",0,0.3,3771.02,1131.31,1193.78,1.1],["05/13/2021",0,0.0,4000.0,0.0,0.0,-0.1],["01/04/2022",0,0.1,3856.16,385.62,397.93,0.8],["01/06/2022",0,0.1,3505.6,350.56,397.93,3.1],["01/06/2022",0,0.1,3305.28,330.53,397.93,4.6],["01/14/2022",0,0.1,3205.12,320.51,397.93,5.4],["01/20/2022",0,0.1,3004.8,300.48,397.93,7.1],["01/21/2022",0,0.1,2804.48,280.45,397.93,9.0],["01/25/2022",0,0.1,2403.84,240.38,397.93,13.2],["01/31/2022",0,0.1,2504.0,250.4,397.93,12.1],["02/02/2022",0,0.1,2754.4,275.44,397.93,9.5],["02/07/2022",0,0.1,3004.8,300.48,397.93,7.2],["02/10/2022",0,0.1,3104.96,310.5,397.93,6.4],["02/11/2022",0,0.1,3054.88,305.49,397.93,6.8],["02/11/2022",0,0.1,3054.88,305.49,397.93,6.8],["02/12/2022",0,0.1,2904.64,290.46,397.93,8.2],["02/13/2022",0,0.15,2854.56,428.18,596.89,8.6],["02/16/2022",0,0.1,3054.88,305.49,397.93,6.8],["02/17/2022",0,0.1,3004.8,300.48,397.93,7.3],["02/17/2022",0,0.1,2904.64,290.46,397.93,8.2],["02/18/2022",0,0.1,2804.48,280.45,397.93,9.1],["02/20/2022",0,0.1,2704.32,270.43,397.93,10.2],["02/20/2022",0,0.1,2604.16,260.42,397.93,11.2],["03/07/2022",0,0.1,2604.16,260.42,397.93,11.3],["03/07/2022",0,0.1,2504.0,250.4,397.93,12.4],["03/13/2022",0,0.1,2504.0,250.4,397.93,12.5],["03/31/2022",0,0.1,3255.2,325.52,397.93,5.3],["04/06/2022",0,0.1,3205.12,320.51,397.93,5.8],["04/26/2022",0,0.1,2800.0,280.0,397.93,9.7],["05/05/2022",0,0.1,2700.0,270.0,397.93,10.8],["05/07/2022",0,0.1,2600.0,260.0,397.93,11.9],["05/08/2022",0,0.1,2500.0,250.0,397.93,13.1],["05/12/2022",0,0.1,2100.0,210.0,397.93,18.5],["05/14/2022",0,0.1,2000.0,200.0,397.93,20.1]],
"metamask|ETHUSD":[["02/12/2022",0,1.18,2904.64,3441.67,4695.53,8.2]],
"schwab_individual|SWVXX":[["03/23/2023",0,1.0,25000.0,25000.0,27554.79,3.4]],
"schwab_individual|VOO":[["04/06/2023",0,10.0,373.75,3737.5,6107.6,18.7],["06/23/2023",0,30.0,400.65,12019.5,18322.8,17.2],["07/06/2023",0,0.16,401.85,63.09,97.72,17.3],["07/26/2023",0,20.0,417.63,8352.6,12215.2,16.0],["10/04/2023",0,0.23,387.32,89.86,140.47,21.2],["12/27/2023",0,0.25,437.35,108.9,152.69,16.9],["03/28/2024",0,0.2,480.78,93.75,122.15,13.5],["07/02/2024",0,0.22,502.27,108.49,134.37,12.8],["10/01/2024",0,0.19,520.99,100.03,116.04,12.2],["12/26/2024",0,0.19,552.52,106.64,116.04,9.2],["03/04/2025",0,18.0,528.0,9504.0,10993.68,16.4],["03/31/2025",0,0.28,505.58,143.94,171.01,23.9],["07/02/2025",0,0.24,568.14,139.08,146.58,12.2],["10/01/2025",0,0.23,611.02,139.13,140.47,-0.1]],
"schwab_rsu|GOOG":[["12/25/2021",0,35.54,147.14,5229.44,9043.15,14.1],["03/25/2023",0,5.92,106.06,628.09,1506.34,35.2],["04/25/2023",0,5.92,106.78,632.35,1506.34,36.1],["06/25/2023",0,35.53,123.02,4371.27,9040.61,31.6],["09/25/2023",0,35.53,131.25,4663.58,9040.61,31.8],["12/25/2023",0,26.53,142.72,3786.22,6750.56,30.9],["03/25/2024",0,4.15,151.77,629.24,1055.97,31.3],["03/25/2024",0,23.69,151.77,3595.13,6027.92,31.3],["04/25/2024",0,4.15,161.1,667.92,1055.97,28.7],["06/25/2024",0,23.72,180.79,4287.43,6035.55,23.1],["08/25/2024",0,6.52,167.43,1091.98,1659.01,32.7],["09/25/2024",0,13.12,163.64,2146.47,3338.38,37.2],["09/25/2024",0,6.56,163.64,1073.31,1669.19,37.2],["10/25/2024",0,6.47,164.53,1064.34,1646.29,39.4],["11/25/2024",0,6.47,166.57,1077.37,1646.29,41.2],["12/25/2024",0,6.48,197.57,1279.27,1648.84,24.7],["12/25/2024",0,12.95,197.57,2558.33,3295.13,24.7],["01/25/2025",0,5.96,201.9,1203.93,1516.52,24.4],["02/25/2025",0,5.96,181.19,1080.44,1516.52,41.6],["03/25/2025",0,5.97,169.93,1014.48,1519.07,56.7],["03/25/2025",0,11.94,169.93,2028.79,3038.13,56.7],["04/25/2025",0,5.97,161.47,963.98,1519.07,74.9],["06/25/2025",0,11.95,167.74,2005.0,3040.68,90.5],["09/25/2025",0,13.03,247.83,3228.98,3315.48,6.9]],
"td_tfsa|FB":[["05/10/2017","09/20/2018",40.0,115.57,4622.8,5094.0,7.4]],
"td_tfsa|NSDQ INDX":[["12/21/2016","4/17/2017",385.51,9.98,3847.34,4190.44,30.5],["12/05/2017",0,291.93,12.62,3684.16,16333.48,19.9]],
"td_tfsa|US INDX":[["12/21/2016","04/17/2017",94.81,40.57,3846.24,3977.07,11.0],["12/05/2017",0,46.4,151.52,7030.83,7696.83,1.1]],
};
const parseLot = (a) => ({d:a[0],sd:a[1]||null,sh:a[2],px:a[3],cb:a[4],mv:a[5],ar:a[6]});

// Symbol-level ann return: cost-basis-weighted average of lot ann_returns (active lots only)
const symAnn = (acctId, symbol) => {
  const raw = L[`${acctId}|${symbol}`];
  if (!raw) return null;
  const all = raw.map(parseLot).filter(l => l.cb > 0);
  if (!all.length) return null;
  const totalCb = all.reduce((s, l) => s + l.cb, 0);
  if (totalCb <= 0) return null;
  return all.reduce((s, l) => s + l.cb * l.ar, 0) / totalCb;
};

const ACCOUNTS = [
  { id:"vanguard_401k", label:"Vanguard 401K", type:"retirement_401k", institution:"Vanguard",
    holdings: [{ symbol:"2060 Trust", asset_class:"target_date", shares:0, cost_basis:165605.67, market_value:225328.92, latest_price:null }] },
  { id:"schwab_rsu", label:"Schwab RSU", type:"rsu", institution:"Charles Schwab",
    holdings: [{ symbol:"GOOG", asset_class:"us_equity", shares:320.02, cost_basis:50307.34, market_value:81429.09, latest_price:254.45 }] },
  { id:"schwab_individual", label:"Schwab Individual", type:"brokerage", institution:"Charles Schwab",
    holdings: [
      { symbol:"SWVXX", asset_class:"money_market", shares:1, cost_basis:25000, market_value:27554.79, latest_price:27554.79 },
      { symbol:"VOO", asset_class:"us_equity", shares:80.19, cost_basis:34706.51, market_value:48976.84, latest_price:610.76 },
    ] },
  { id:"schwab_401k", label:"Schwab 401K", type:"retirement_401k", institution:"Charles Schwab",
    holdings: [
      { symbol:"WBREOX", asset_class:"us_equity", shares:0, cost_basis:19593.46, market_value:33987.40, latest_price:null },
      { symbol:"WBRUOX", asset_class:"intl_equity", shares:0, cost_basis:10096.65, market_value:9675.61, latest_price:null },
      { symbol:"VBAIX", asset_class:"balanced", shares:0, cost_basis:10096.58, market_value:13322.83, latest_price:null },
      { symbol:"VMCIX", asset_class:"us_equity", shares:0, cost_basis:5039.34, market_value:7219.07, latest_price:null },
      { symbol:"VSCIX", asset_class:"us_equity", shares:0, cost_basis:5039.12, market_value:6948.72, latest_price:null },
    ] },
  { id:"etrade_brokerage", label:"eTrade Brokerage", type:"brokerage", institution:"E*TRADE",
    holdings: [
      { symbol:"SCHD", asset_class:"us_equity", shares:34.41, cost_basis:740.70, market_value:921.50, latest_price:26.78 },
      { symbol:"VTSAX", asset_class:"us_equity", shares:288.97, cost_basis:26714.03, market_value:46030.03, latest_price:159.29 },
      { symbol:"VXUS", asset_class:"intl_equity", shares:54.13, cost_basis:3002.83, market_value:4016.45, latest_price:74.20 },
      { symbol:"VUG", asset_class:"us_equity", shares:24.33, cost_basis:5984.85, market_value:11639.47, latest_price:478.40 },
      { symbol:"VTI", asset_class:"us_equity", shares:0, cost_basis:10222.63, market_value:8786.00, latest_price:null, sold:true },
    ] },
  { id:"etrade_ira", label:"eTrade IRA", type:"retirement_ira", institution:"E*TRADE",
    holdings: [
      { symbol:"BBUS", asset_class:"us_equity", shares:53.77, cost_basis:3228.73, market_value:6468.53, latest_price:120.30 },
      { symbol:"QQQ", asset_class:"us_equity", shares:18.55, cost_basis:4461.10, market_value:11202.90, latest_price:603.93 },
      { symbol:"SCHD", asset_class:"us_equity", shares:126.43, cost_basis:2753.52, market_value:3385.80, latest_price:26.78 },
      { symbol:"VIG", asset_class:"us_equity", shares:19.75, cost_basis:2781.06, market_value:4259.68, latest_price:215.68 },
    ] },
  { id:"td_tfsa", label:"TD TFSA", type:"tax_free", institution:"TD",
    holdings: [
      { symbol:"NSDQ INDX", asset_class:"intl_equity", shares:291.93, cost_basis:3684.16, market_value:16333.48, latest_price:55.95 },
      { symbol:"US INDX", asset_class:"intl_equity", shares:46.40, cost_basis:7030.83, market_value:7696.83, latest_price:165.88 },
      { symbol:"FB", asset_class:"us_equity", shares:0, cost_basis:4622.80, market_value:5094.00, latest_price:null, sold:true },
    ] },
  { id:"kraken", label:"Kraken", type:"crypto", institution:"Kraken",
    holdings: [
      { symbol:"ADAUSD", asset_class:"crypto", shares:500, cost_basis:861.38, market_value:325.00, latest_price:0.65 },
      { symbol:"ETHUSD", asset_class:"crypto", shares:4.20, cost_basis:11335.26, market_value:16712.89, latest_price:3979.26 },
      { symbol:"BTCUSD", asset_class:"crypto", shares:0.06, cost_basis:2379.33, market_value:6515.70, latest_price:108595 },
    ] },
  { id:"health_equity_hsa", label:"HSA", type:"hsa", institution:"HealthEquity",
    holdings: [
      { symbol:"VIGIX", asset_class:"us_equity", shares:24.78, cost_basis:4037.48, market_value:6102.82, latest_price:246.28 },
      { symbol:"VSMAX", asset_class:"us_equity", shares:40.41, cost_basis:4118.29, market_value:4902.54, latest_price:121.32 },
      { symbol:"VIIIX", asset_class:"us_equity", shares:10.33, cost_basis:4213.80, market_value:5598.96, latest_price:542.01 },
      { symbol:"VEMPX", asset_class:"us_equity", shares:13.33, cost_basis:4100.84, market_value:5207.23, latest_price:390.64 },
    ] },
  { id:"metamask", label:"Metamask", type:"crypto", institution:"Metamask",
    holdings: [{ symbol:"ETHUSD", asset_class:"crypto", shares:1.18, cost_basis:3441.67, market_value:4695.53, latest_price:3979.26 }] },
];

const ACM = {
  us_equity:{label:"US Equity",color:"#4A6FA5",target:70}, intl_equity:{label:"International",color:"#81B29A",target:10},
  crypto:{label:"Crypto",color:"#E07A5F",target:5}, balanced:{label:"Balanced",color:"#F2CC8F",target:5},
  money_market:{label:"Money Market",color:"#6B9AC4",target:5}, target_date:{label:"Target Date",color:"#9B8EA0",target:5},
};
const ATL={retirement_401k:"401(k)",retirement_ira:"IRA",brokerage:"Brokerage",tax_free:"Tax-Free",hsa:"HSA",rsu:"RSU",crypto:"Crypto"};

// Account-level annualized returns (cost-weighted avg of lot ann_returns; Schwab 401K from CSV)
const ACCT_ANN={"etrade_brokerage":9.2,"etrade_ira":11.9,"health_equity_hsa":14.2,"kraken":10.1,"metamask":8.2,"schwab_individual":11.2,"schwab_rsu":32.4,"td_tfsa":11.9,"schwab_401k":7.3,"vanguard_401k":null};
const fmt=v=>{if(Math.abs(v)>=1e6)return`$${(v/1e6).toFixed(1)}M`;if(Math.abs(v)>=1e3)return`$${(v/1e3).toFixed(1)}K`;return`$${v.toFixed(0)}`};
const fF=v=>`$${v.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fP=v=>`${v>=0?"+":""}${v.toFixed(1)}%`;
const M={fontFamily:"'DM Mono',monospace"};
const LS={...M,fontSize:11,padding:"5px 0"}; // lot row style

export default function PortfolioTab() {
  const [exAcct,setExAcct]=useState(null);
  const [exSym,setExSym]=useState(null);
  const [view,setView]=useState("overview");

  const totals=useMemo(()=>{
    let tc=0,tm=0;const ba=[],bac={};
    for(const a of ACCOUNTS){let ac=0,am=0;
      for(const h of a.holdings){if(h.sold)continue;if(h.market_value===0&&h.cost_basis<=0)continue;ac+=h.cost_basis;am+=h.market_value;
        const c=h.asset_class;if(!bac[c])bac[c]={cost:0,market:0};bac[c].cost+=h.cost_basis;bac[c].market+=h.market_value;}
      tc+=ac;tm+=am;ba.push({...a,totalCost:ac,totalMarket:am,gain:am-ac,pctReturn:ac>0?((am-ac)/ac)*100:0,annReturn:ACCT_ANN[a.id]??null});}
    const alloc=Object.entries(bac).map(([ac,d])=>({asset_class:ac,...ACM[ac],value:d.market,pct:(d.market/tm)*100})).sort((a,b)=>b.value-a.value);
    // Portfolio annualized: cost-weighted avg of accounts that have ann data
    let paNum=0,paDen=0;for(const a of ba){const ar=ACCT_ANN[a.id];if(ar!==null&&ar!==undefined&&a.totalCost>0){paNum+=a.totalCost*ar;paDen+=a.totalCost;}}
    const portfolioAnn=paDen>0?paNum/paDen:null;
    return{totalCost:tc,totalMarket:tm,totalGain:tm-tc,totalPct:tc>0?((tm-tc)/tc)*100:0,byAccount:ba.filter(a=>a.totalMarket>0),allocation:alloc,portfolioAnn};
  },[]);

  const perfData=useMemo(()=>totals.byAccount.map(a=>({name:a.label,cost:a.totalCost,gain:Math.max(0,a.gain),total:a.totalMarket})).sort((a,b)=>b.total-a.total),[totals]);

  const CTT=({active,payload})=>{
    if(!active||!payload?.length)return null;const d=payload[0]?.payload;
    return(<div style={{background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px 14px",fontSize:12}}>
      <div style={{fontWeight:700,marginBottom:4}}>{d.name}</div>
      <div style={{color:"rgba(255,255,255,0.5)"}}>Cost: {fF(d.cost)}</div>
      <div style={{color:"#81B29A"}}>Market: {fF(d.total)}</div>
      <div style={{color:d.gain>0?"#81B29A":"#E07A5F"}}>Gain: {fF(d.gain)}</div>
    </div>);
  };

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:"linear-gradient(180deg,#0d0d1a 0%,#111122 100%)",color:"#fff",minHeight:"100vh",padding:"24px 28px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`}</style>

      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12}}><h1 style={{fontSize:22,fontWeight:700,letterSpacing:"-0.02em"}}>Portfolio</h1><span style={{fontSize:11,color:"rgba(255,255,255,0.25)",...M}}>Prices as of Oct 19, 2025</span></div>
        <div style={{display:"flex",gap:6,marginTop:12}}>
          {["overview","holdings","allocation"].map(v=>(<button key={v} onClick={()=>setView(v)} style={{background:view===v?"rgba(255,255,255,0.08)":"transparent",border:view===v?"1px solid rgba(255,255,255,0.12)":"1px solid transparent",color:view===v?"#fff":"rgba(255,255,255,0.4)",padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer",textTransform:"capitalize"}}>{v}</button>))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:28}}>
        {[{l:"Market Value",v:fF(totals.totalMarket),a:"#81B29A"},{l:"Cost Basis",v:fF(totals.totalCost),a:"#4A6FA5"},{l:"Unrealized Gain",v:fF(totals.totalGain),a:totals.totalGain>=0?"#81B29A":"#E07A5F"},{l:"Total Return",v:fP(totals.totalPct),a:totals.totalPct>=0?"#81B29A":"#E07A5F"},{l:"Ann. Return",v:totals.portfolioAnn!==null?fP(totals.portfolioAnn):"—",a:totals.portfolioAnn!==null?(totals.portfolioAnn>=0?"#81B29A":"#E07A5F"):"rgba(255,255,255,0.3)",s:totals.portfolioAnn!==null?"Excl. Vanguard 401K":null}].map(c=>(
          <div key={c.l} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"16px 18px"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:6}}>{c.l}</div><div style={{fontSize:20,fontWeight:700,...M,color:c.a}}>{c.v}</div>{c.s&&<div style={{fontSize:9,color:"rgba(255,255,255,0.2)",marginTop:4}}>{c.s}</div>}</div>))}
      </div>

      {view==="overview"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:24}}>
            <h3 style={{fontSize:14,fontWeight:600,color:"rgba(255,255,255,0.7)",margin:"0 0 4px"}}>Asset Allocation</h3>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.3)",margin:"0 0 16px"}}>Target: 70% US / 10% Intl / 5% each other</p>
            <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={totals.allocation} cx="50%" cy="50%" innerRadius={50} outerRadius={82} paddingAngle={2} dataKey="value">{totals.allocation.map((c,i)=><Cell key={i} fill={c.color}/>)}</Pie><Tooltip formatter={v=>fF(v)} contentStyle={{background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12}}/></PieChart></ResponsiveContainer>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
              {totals.allocation.map(a=>(<div key={a.asset_class} style={{display:"grid",gridTemplateColumns:"110px 1fr 45px 45px",alignItems:"center",gap:8,fontSize:11}}>
                <span style={{display:"flex",alignItems:"center",gap:6,color:"rgba(255,255,255,0.6)"}}><span style={{width:8,height:8,borderRadius:2,background:a.color,flexShrink:0}}/>{a.label}</span>
                <div style={{height:6,background:"rgba(255,255,255,0.04)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(a.pct,100)}%`,background:a.color,borderRadius:3}}/></div>
                <span style={{...M,fontSize:10,color:"rgba(255,255,255,0.5)",textAlign:"right"}}>{a.pct.toFixed(1)}%</span>
                <span style={{...M,fontSize:10,color:"rgba(255,255,255,0.25)",textAlign:"right"}}>({a.target}%)</span>
              </div>))}
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:24}}>
            <h3 style={{fontSize:14,fontWeight:600,color:"rgba(255,255,255,0.7)",margin:"0 0 4px"}}>Account Performance</h3>
            <ResponsiveContainer width="100%" height={240}><BarChart data={perfData} layout="vertical" margin={{left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis type="number" tick={{fill:"rgba(255,255,255,0.3)",fontSize:10}} tickFormatter={fmt}/>
              <YAxis type="category" dataKey="name" tick={{fill:"rgba(255,255,255,0.5)",fontSize:10}} width={95}/><Tooltip content={<CTT/>}/>
              <Bar dataKey="cost" stackId="a" fill="#4A6FA5" opacity={0.6}/><Bar dataKey="gain" stackId="a" fill="#81B29A" radius={[0,4,4,0]}/>
            </BarChart></ResponsiveContainer>
            <div style={{display:"flex",flexDirection:"column",gap:4,marginTop:8}}>
              {totals.byAccount.map(a=>(<div key={a.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0"}}><span style={{color:"rgba(255,255,255,0.45)"}}>{a.label}</span><div style={{display:"flex",gap:12}}><span style={{...M,color:a.pctReturn>=0?"#81B29A":"#E07A5F"}}>{fP(a.pctReturn)}</span><span style={{...M,color:a.annReturn!==null?(a.annReturn>=0?"#81B29A":"#E07A5F"):"rgba(255,255,255,0.25)",minWidth:50,textAlign:"right"}}>{a.annReturn!==null?fP(a.annReturn):"—"}</span></div></div>))}
            </div>
          </div>
        </div>
      )}

      {view==="holdings"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {totals.byAccount.map(acct=>{
            const isEx=exAcct===acct.id;
            return(<div key={acct.id} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,overflow:"hidden"}}>
              <div onClick={()=>{setExAcct(isEx?null:acct.id);setExSym(null);}}
                style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto auto",gap:16,padding:"14px 20px",cursor:"pointer",alignItems:"center"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{transform:isEx?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",fontSize:10,color:"rgba(255,255,255,0.3)"}}>▶</span>{acct.label}
                    <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{ATL[acct.type]}</span>
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:2}}>{acct.institution} · {acct.holdings.filter(h=>h.market_value>0&&!h.sold).length} active{acct.holdings.some(h=>h.sold)?" + "+acct.holdings.filter(h=>h.sold).length+" sold":""}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Cost</div><div style={{fontSize:13,...M,color:"rgba(255,255,255,0.5)"}}>{fF(acct.totalCost)}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Market</div><div style={{fontSize:13,...M,color:"#81B29A"}}>{fF(acct.totalMarket)}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Gain</div><div style={{fontSize:13,...M,color:acct.gain>=0?"#81B29A":"#E07A5F"}}>{fF(acct.gain)}</div></div>
                <div style={{textAlign:"right",minWidth:55}}><div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Return</div><div style={{fontSize:13,...M,color:acct.pctReturn>=0?"#81B29A":"#E07A5F",fontWeight:600}}>{fP(acct.pctReturn)}</div></div>
                <div style={{textAlign:"right",minWidth:50}}><div style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Ann.</div><div style={{fontSize:13,...M,color:acct.annReturn!==null?(acct.annReturn>=0?"#81B29A":"#E07A5F"):"rgba(255,255,255,0.3)"}}>{acct.annReturn!==null?fP(acct.annReturn):"—"}</div></div>
              </div>

              {isEx&&(<div style={{borderTop:"1px solid rgba(255,255,255,0.04)",padding:"0 20px 14px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{color:"rgba(255,255,255,0.3)",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                    {["Symbol","Shares","Price","Cost","Market","Gain","Return","Ann."].map(h=>
                      <th key={h} style={{textAlign:h==="Symbol"?"left":"right",padding:"10px 0 6px",fontWeight:500}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {acct.holdings.filter(h=>h.market_value>0||h.cost_basis>0||h.sold).map(h=>{
                      const g=h.market_value-h.cost_basis, r=h.cost_basis>0?(g/h.cost_basis)*100:0;
                      const lk=`${acct.id}|${h.symbol}`, rawLots=(L[lk]||[]).map(parseLot);
                      const isSE=exSym===lk, active=rawLots.filter(l=>!l.sd), sold=rawLots.filter(l=>l.sd);
                      const sa=symAnn(acct.id,h.symbol);
                      const gc=g>=0?"#81B29A":"#E07A5F";
                      const isSold=h.sold||false;
                      return(
                        <React.Fragment key={h.symbol}>
                          <tr style={{borderTop:"1px solid rgba(255,255,255,0.03)",cursor:rawLots.length?"pointer":"default",opacity:isSold?0.55:1}}
                            onClick={e=>{e.stopPropagation();rawLots.length&&setExSym(isSE?null:lk);}}
                            onMouseEnter={e=>{if(rawLots.length)e.currentTarget.style.background="rgba(255,255,255,0.02)"}}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <td style={{padding:"8px 0",fontWeight:600}}><div style={{display:"flex",alignItems:"center",gap:6}}>
                              <span style={{width:6,height:6,borderRadius:2,background:ACM[h.asset_class]?.color||"#888"}}/>
                              {rawLots.length>0&&<span style={{fontSize:8,color:"rgba(255,255,255,0.2)",transform:isSE?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",display:"inline-block"}}>▶</span>}
                              {h.symbol}{isSold&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(224,122,95,0.15)",color:"#E07A5F",marginLeft:4}}>SOLD</span>}
                              {rawLots.length>0&&<span style={{fontSize:9,color:"rgba(255,255,255,0.2)",...M}}>{rawLots.length}</span>}
                            </div></td>
                            <td style={{textAlign:"right",...M,color:"rgba(255,255,255,0.5)",padding:"8px 0"}}>{h.shares>0?h.shares.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4}):"—"}</td>
                            <td style={{textAlign:"right",...M,color:"rgba(255,255,255,0.5)",padding:"8px 0"}}>{h.latest_price?`$${h.latest_price.toLocaleString("en-US",{minimumFractionDigits:2})}`:"—"}</td>
                            <td style={{textAlign:"right",...M,color:"rgba(255,255,255,0.5)",padding:"8px 0"}}>{fF(h.cost_basis)}</td>
                            <td style={{textAlign:"right",...M,color:isSold?"rgba(255,255,255,0.5)":"#81B29A",padding:"8px 0"}}>{isSold?fF(h.market_value):fF(h.market_value)}</td>
                            <td style={{textAlign:"right",...M,color:gc,padding:"8px 0"}}>{fF(g)}</td>
                            <td style={{textAlign:"right",...M,color:gc,fontWeight:600,padding:"8px 0"}}>{fP(r)}</td>
                            <td style={{textAlign:"right",...M,color:sa!==null?(sa>=0?"#81B29A":"#E07A5F"):"rgba(255,255,255,0.3)",padding:"8px 0"}}>{sa!==null?fP(sa):"—"}</td>
                          </tr>

                          {isSE&&active.map((lot,i)=>{const lg=lot.mv-lot.cb,lr=lot.cb>0?(lg/lot.cb)*100:0;const lc=lg>=0?"rgba(129,178,154,0.6)":"rgba(224,122,95,0.6)";
                            return(<tr key={i} style={{background:"rgba(74,111,165,0.04)"}}>
                              <td style={{padding:"5px 0 5px 28px",color:"rgba(255,255,255,0.35)",...LS}}>{lot.d}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.35)",...LS}}>{lot.sh.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4})}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.35)",...LS}}>${lot.px.toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.35)",...LS}}>{fF(lot.cb)}</td>
                              <td style={{textAlign:"right",color:lc,...LS}}>{fF(lot.mv)}</td>
                              <td style={{textAlign:"right",color:lc,...LS}}>{fF(lg)}</td>
                              <td style={{textAlign:"right",color:lc,...LS}}>{fP(lr)}</td>
                              <td style={{textAlign:"right",color:lot.ar>=0?"rgba(129,178,154,0.6)":"rgba(224,122,95,0.6)",...LS}}>{fP(lot.ar)}</td>
                            </tr>);})}

                          {isSE&&sold.length>0&&<tr><td colSpan={8} style={{padding:"6px 0 2px 28px",fontSize:9,color:"rgba(255,255,255,0.2)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Sold</td></tr>}
                          {isSE&&sold.map((lot,i)=>{const lg=lot.mv-lot.cb,lr=lot.cb>0?(lg/lot.cb)*100:0;const sc=lg>=0?"rgba(129,178,154,0.5)":"rgba(224,122,95,0.5)";
                            return(<tr key={`s${i}`} style={{background:"rgba(224,122,95,0.03)",opacity:0.6}}>
                              <td style={{padding:"5px 0 5px 28px",color:"rgba(255,255,255,0.3)",...LS}}>{lot.d} <span style={{color:"rgba(255,255,255,0.15)"}}>→ {lot.sd}</span></td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.3)",...LS}}>{lot.sh.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4})}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.3)",...LS}}>${lot.px.toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.3)",...LS}}>{fF(lot.cb)}</td>
                              <td style={{textAlign:"right",color:"rgba(255,255,255,0.3)",...LS}}>{fF(lot.mv)}</td>
                              <td style={{textAlign:"right",color:sc,...LS}}>{fF(lg)}</td>
                              <td style={{textAlign:"right",color:sc,...LS}}>{fP(lr)}</td>
                              <td style={{textAlign:"right",color:sc,...LS}}>{fP(lot.ar)}</td>
                            </tr>);})}
                        </React.Fragment>);
                    })}
                  </tbody>
                </table>
              </div>)}
            </div>);
          })}
        </div>
      )}

      {view==="allocation"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {totals.allocation.map(a=>{
            const delta=a.pct-a.target;
            const hs=ACCOUNTS.flatMap(ac=>ac.holdings.filter(h=>h.asset_class===a.asset_class&&h.market_value>0).map(h=>({...h,account:ac.label})));
            return(<div key={a.asset_class} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"18px 22px",borderLeft:`3px solid ${a.color}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div><div style={{fontSize:15,fontWeight:600}}>{a.label}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginTop:2}}>{hs.length} holding{hs.length!==1?"s":""}</div></div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,...M,color:a.color}}>{fF(a.value)}</div>
                  <div style={{fontSize:11,marginTop:2}}>
                    <span style={{color:"rgba(255,255,255,0.4)"}}>{a.pct.toFixed(1)}%</span><span style={{color:"rgba(255,255,255,0.2)",margin:"0 4px"}}>|</span>
                    <span style={{color:"rgba(255,255,255,0.4)"}}>{a.target}% target</span><span style={{color:"rgba(255,255,255,0.2)",margin:"0 4px"}}>|</span>
                    <span style={{color:Math.abs(delta)<=2?"#81B29A":delta>0?"#F2CC8F":"#E07A5F",fontWeight:600}}>{delta>=0?"+":""}{delta.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div style={{height:6,background:"rgba(255,255,255,0.04)",borderRadius:3,overflow:"hidden",position:"relative",marginBottom:14}}>
                <div style={{height:"100%",width:`${Math.min(a.pct,100)}%`,background:a.color,borderRadius:3}}/><div style={{position:"absolute",top:-2,left:`${a.target}%`,width:2,height:10,background:"rgba(255,255,255,0.4)",borderRadius:1}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
                {hs.map((h,i)=>(<div key={`${h.symbol}-${h.account}-${i}`} style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"8px 12px",border:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span style={{fontWeight:600}}>{h.symbol}</span><span style={{...M,color:a.color,fontSize:11}}>{fF(h.market_value)}</span></div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:2}}>{h.account}</div>
                </div>))}
              </div>
            </div>);})}
        </div>
      )}

      <div style={{marginTop:32,padding:"16px 0",borderTop:"1px solid rgba(255,255,255,0.04)",fontSize:11,color:"rgba(255,255,255,0.2)",display:"flex",justifyContent:"space-between"}}>
        <span>315 lots · 10 accounts · 31 symbols</span><span>Prices as of Oct 19, 2025</span>
      </div>
    </div>
  );
}
