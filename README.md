# 🗺️ Route Optimizer - Sistem Optimasi Rute Distribusi Brosur

Aplikasi web untuk mengoptimalkan rute distribusi brosur berdasarkan data koordinat geografis dari file Excel. Sistem menggunakan **Round-Trip Routing** di mana setiap rute dimulai dan diakhiri di depot yang sama.

## 🚀 Fitur Utama

- ✅ Upload file Excel dengan koordinat lat/long
- ✅ **Round-Trip Routing**: Rute dimulai dari depot dan kembali ke depot
- ✅ Algoritma optimasi rute (Nearest Neighbor)
- ✅ Pengelompokan lokasi berdasarkan area (radius dapat disesuaikan)
- ✅ **Depot System**: Titik awal dan akhir rute yang tetap
- ✅ Visualisasi peta interaktif dengan Leaflet (OpenStreetMap)
- ✅ **Road Routing**: Rute jalan aktual menggunakan OSRM API
- ✅ Export hasil optimasi ke Excel
- ✅ Interface yang user-friendly

## 📋 Persyaratan

- Node.js (v14 atau lebih baru)
- Browser modern (Chrome, Firefox, Safari, Edge)
- Koneksi internet (untuk peta OpenStreetMap dan OSRM routing)

## 🛠️ Instalasi

1. **Clone atau download project**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Jalankan aplikasi:**
   ```bash
   npm start
   ```
4. **Buka browser** dan akses: `http://localhost:3000`

## 📊 Format File Excel

File Excel harus memiliki kolom-kolom berikut:

### Kolom Wajib:
- `lat` atau `latitude` - Koordinat latitude
- `lng` atau `longitude` atau `lon` - Koordinat longitude

### Kolom Opsional:
- `name` atau `nama` - Nama lokasi/klinik
- `address` atau `alamat` - Alamat lengkap lokasi
- `kota` atau `city` - Nama kota (untuk pengelompokan area)
- `telepon` atau `phone` - Nomor telepon
- `website` atau `web` - Website lokasi

### Contoh Format:
| lat       | lng        | name              | address           | kota       | telepon       |
|-----------|------------|-------------------|-------------------|------------|---------------|
| -7.250000 | 112.750000 | Klinik Sehat      | Jl. Sudirman No.1 | Surabaya   | 031-123456    |
| -7.257000 | 112.765000 | Klinik Mulia      | Jl. Thamrin No.5  | Surabaya   | 031-789012    |

## 🎯 Cara Penggunaan

1. **Upload File Excel**
   - Klik "Pilih File Excel"
   - Pilih file dengan format yang sesuai
   - **Input Koordinat Depot**:
     - Masukkan latitude dan longitude depot
     - Default: -7.308038359802376, 112.75515659824273
     - Tip: Klik kanan di Google Maps → "What's here?" untuk mendapatkan koordinat
   - Atur **radius area** untuk pengelompokan (default: 5 km)

2. **Optimasi Rute**
   - Klik tombol "Optimasi Rute"
   - Sistem akan:
     - Membaca semua lokasi dari file Excel
     - Mengelompokkan lokasi berdasarkan proximity (jarak)
     - Menambahkan depot sebagai titik awal dan akhir
     - Mengoptimasi rute dalam setiap grup dengan algoritma Nearest Neighbor
   - Tunggu proses optimasi selesai

3. **Lihat Hasil**
   - Hasil akan ditampilkan dalam bentuk:
     - Ringkasan (total lokasi, hari, jarak)
     - **Peta interaktif** dengan marker depot 🏠 dan rute
     - Daftar rute per hari

4. **Interaksi Peta**
   - **Depot Marker** (🏠 hijau): Titik awal dan akhir setiap rute
   - **Delivery Marker** (angka berwarna): Lokasi delivery
   - Klik marker untuk melihat detail lokasi
   - Garis rute menunjukkan jalur jalan aktual
   - Gunakan tombol "Lihat di Peta" untuk fokus ke hari tertentu

5. **Export Hasil**
   - Klik "Export ke Excel" untuk download hasil optimasi
   - Export akan menampilkan depot sebagai START dan FINISH

## 🏠 Konfigurasi Depot

### Input via UI (Direkomendasikan)
Koordinat depot dapat diinput langsung melalui antarmuka aplikasi:
- **Latitude**: Koordinat lintang depot (default: -7.308038359802376)
- **Longitude**: Koordinat bujur depot (default: 112.75515659824273)

### Cara Mendapatkan Koordinat
1. Buka Google Maps
2. Klik kanan pada lokasi depot
3. Pilih "What's here?"
4. Koordinat akan muncul di format: `latitude, longitude`

### Default Coordinates
Jika tidak diinput, sistem menggunakan koordinat default:
- **Latitude:** -7.308038359802376 (Surabaya Timur)
- **Longitude:** 112.75515659824273

### Validasi
Sistem akan memvalidasi koordinat:
- Latitude harus antara -90 dan 90
- Longitude harus antara -180 dan 180
- Format yang salah akan menampilkan error message

## 🧮 Algoritma Optimasi

### 1. Round-Trip Routing dengan Depot
Setiap rute harian mengikuti pola:
```
🏠 DEPOT → Lokasi 1 → Lokasi 2 → ... → Lokasi N → 🏠 DEPOT
```

### 2. Area-Based Grouping
- Lokasi dikelompokkan berdasarkan proximity (jarak)
- Default radius: 5 km
- Lokasi dalam radius yang sama akan dikelompokkan menjadi 1 rute harian

### 3. Nearest Neighbor Algorithm
- **Mulai dari depot** sebagai titik awal
- Cari lokasi terdekat yang belum dikunjungi
- Pindah ke lokasi tersebut
- Ulangi hingga semua lokasi dikunjungi
- **Kembali ke depot** untuk menyelesaikan round-trip

### 4. Perhitungan Jarak (Haversine Formula)
```
a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlon/2)
c = 2 × atan2(√a, √(1−a))
d = R × c (dimana R = 6,371 km)
```

### 5. Road Routing dengan OSRM
- Menggunakan OSRM (Open Source Routing Machine) API
- Memberikan rute jalan aktual, bukan garis lurus
- Lebih akurat untuk perencanaan perjalanan nyata

## 📊 Struktur Output

### Ringkasan Hasil
- **Total Delivery Stops**: Jumlah lokasi yang harus dikunjungi
- **Total Hari Kerja**: Jumlah hari yang dibutuhkan
- **Total Jarak Tempuh**: Jarak total termasuk kembali ke depot
- **Rata-rata per Hari**: Rata-rata lokasi per hari
- **Depot**: Koordinat titik awal dan akhir

### Detail per Hari
- **Nomor Hari**: Urutan hari kerja
- **Area**: Wilayah/kota yang dilayani
- **Jumlah Stop**: Banyaknya lokasi delivery
- **Total Jarak**: Jarak tempuh round-trip (termasuk balik ke depot)
- **Urutan Rute**: Daftar lokasi berurutan dari depot kembali ke depot

## 🗺️ Fitur Peta

### Marker & Visualisasi
- **🏠 Depot Marker** (Hijau): Titik awal dan akhir setiap rute harian
- **Angka Berwarna**: Lokasi delivery (1, 2, 3, dst.)
- **Warna Berbeda**: Setiap hari memiliki warna rute yang berbeda
- **Info Window**: Klik marker untuk detail lengkap lokasi
- **Polyline**: Garis rute mengikuti jalan aktual (bukan garis lurus)
- **Auto Zoom**: Peta otomatis menyesuaikan area

### Peta Interaktif
- **OpenStreetMap**: Peta gratis dan open-source
- **OSRM Routing**: Rute jalan aktual (bukan garis lurus)
- **Google Maps Links**: Buka rute langsung di Google Maps
- **Multi-segment**: Rute besar dibagi menjadi segmen (maks 10 lokasi/segmen)

## 📁 Struktur Project

```
routing/
├── server.js           # Backend server
├── package.json        # Dependencies
├── public/
│   ├── index.html     # Frontend interface
│   ├── app.js         # JavaScript logic
│   └── ...
├── uploads/           # Temporary file uploads
└── README.md          # Dokumentasi
```

## 🔧 Konfigurasi

### Input Depot via UI (Direkomendasikan)
Koordinat depot diinput melalui form di halaman aplikasi. Tidak perlu mengedit kode untuk mengubah lokasi depot.

### Mengubah Default Depot (Opsional)
Jika ingin mengubah koordinat default, edit file `server.js`:
```javascript
// Koordinat Depot Default (jika tidak diinput)
const DEFAULT_DEPOT_LAT = -7.308038359802376;  // Ganti dengan default Anda
const DEFAULT_DEPOT_LNG = 112.75515659824273;  // Ganti dengan default Anda
```

### Port Server
Default port: 3000. Dapat diubah dengan environment variable:
```bash
PORT=8080 npm start
```

### Radius Pengelompokan Area
Default: 5 km. Lokasi dalam radius yang sama akan dikelompokkan menjadi 1 rute harian. Anda dapat mengubahnya melalui UI saat upload file.

## 📊 Output Export Excel

File excel yang di-export berisi:

### Sheet 1: Rute Optimasi
- **Ringkasan**: Total lokasi, hari, jarak, rata-rata
- **Detail per Hari**:
  - 🏠 **START**: Depot sebagai titik awal rute
  - **1, 2, 3, ...**: Lokasi delivery berurutan
  - 🏠 **FINISH**: Kembali ke depot
- **Keterangan**: Label jelas untuk setiap stop

### Sheet 2: Google Maps Links (Opsional)
- Link Google Maps untuk setiap segmen rute
- Informasi lokasi lengkap
- Direct link untuk navigasi

### Format Output
| Urutan | Nama Lokasi | Alamat | Latitude | Longitude | Keterangan |
|--------|-------------|---------|----------|-----------|------------|
| 🏠 START | Depot Pusat | Alamat Depot | -7.308... | 112.755... | Depot - Titik Awal Rute Hari 1 |
| 1 | Klinik Sehat | Jl. Sudirman | -7.250... | 112.750... | Delivery Stop 1 - Hari 1 |
| 2 | Klinik Mulia | Jl. Thamrin | -7.257... | 112.765... | Delivery Stop 2 - Hari 1 |
| 🏠 FINISH | Depot Pusat | Alamat Depot | -7.308... | 112.755... | Depot - Kembali ke Base Hari 1 |

## 🐛 Troubleshooting

### Peta Tidak Muncul
1. Periksa koneksi internet (OpenStreetMap butuh koneksi)
2. Refresh halaman browser
3. Cek console browser (F12) untuk error JavaScript

### Upload File Gagal
1. Pastikan format Excel (.xlsx/.xls)
2. Periksa kolom lat/lng ada dan berisi angka valid
3. Pastikan ukuran file tidak terlalu besar (< 5 MB)

### Depot Tidak Muncul
1. Pastikan koordinat depot diinput dengan benar melalui UI
2. Validasi koordinat: Latitude (-90 sampai 90), Longitude (-180 sampai 180)
3. Cek browser console untuk error
4. Refresh halaman dan coba lagi

### Rute Tidak Optimal
1. Coba ubah radius pengelompokan area (default 5 km)
2. Pastikan koordinat lokasi accurate
3. Pertimbangkan untuk memecah area dengan radius lebih kecil

### Google Maps Links Error
1. Google Maps membatasi maksimal 10 lokasi per segmen
2. Untuk rute besar, sistem otomatis membagi menjadi beberapa segmen
3. Setiap segmen dapat dibuka terpisah di Google Maps

## 📱 Browser Support

- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+

## 🔒 Keamanan

- File upload dibatasi format Excel saja (.xlsx, .xls)
- Validasi data koordinat (harus angka valid)
- Temporary file cleanup otomatis
- Tidak ada credentials yang disimpan
- OpenStreetMap dan OSRM adalah layanan gratis (tidak butuh API key)

## 📈 Performance Tips

- **File Size**: Maksimal 1000 lokasi per file
- **Browser**: Gunakan Chrome untuk performa terbaik
- **Network**: Koneksi stabil untuk OSRM routing
- **Radius Area**: Kecil (3-5 km) untuk rute lebih efisien
- **Depot Placement**: Letakkan depot di pusat area layanan

## 💡 Tips Penggunaan

### Menentukan Radius Area
- **3-5 km**: Cocok untuk area perkotaan padat
- **5-10 km**: Cocok untuk area suburban
- **10+ km**: Cocok untuk area rural

### Menentukan Lokasi Depot
- Letakkan depot di titik yang strategis (pusat distribusi)
- Pastikan mudah diakses dari semua area layanan
- Consider traffic patterns dan jarak actual

### Optimasi Multi-Hari
- Sistem otomatis mengelompokkan lokasi berdasarkan proximity
- Setiap grup area = 1 hari kerja
- Total jarak sudah termasuk perjalanan pulang ke depot

## 🆘 Support

Jika mengalami masalah:
1. Periksa console browser (F12) untuk error JavaScript
2. Pastikan file Excel sesuai format yang diminta
3. Restart aplikasi jika diperlukan (`Ctrl+C` lalu `npm start`)
4. Cek koneksi internet (diperlukan untuk peta dan routing)

## 🔄 Changelog

### Versi 2.1 - Depot Input via UI
- ✅ **Input Depot**: Koordinat depot dapat diinput melalui UI (tidak perlu edit kode)
- ✅ **Default Coordinates**: Menggunakan koordinat default jika tidak diinput
- ✅ **Validation**: Validasi koordinat depot di frontend dan backend
- ✅ **User-Friendly**: UI dengan section khusus untuk input depot
- ✅ **Tips**: Cara mendapatkan koordinat dari Google Maps

### Versi 2.0 - Round-Trip Routing
- ✅ **Depot System**: Menambahkan depot sebagai titik awal dan akhir rute
- ✅ **Round-Trip**: Rute kembali ke depot setelah selesai
- ✅ **Road Routing**: Menggunakan OSRM untuk rute jalan aktual
- ✅ **Depot Marker**: Visualisasi depot dengan icon 🏠 yang jelas
- ✅ **Improved Export**: Label START dan FINISH untuk depot
- ✅ **Google Maps Integration**: Filter depot duplikat di links

### Versi 1.0 - Initial Release
- Basic routing optimization
- Area-based grouping
- Excel upload & export
- Peta interaktif

## 📝 Lisensi

MIT License - Gratis untuk penggunaan komersial dan pribadi

---

**© 2024 Route Optimizer - Sistem Optimasi Rute Distribusi dengan Round-Trip Routing**

**Made with ❤️ for efficient delivery operations**

---

**Made with ❤️ by [Digital360](https://digital360.id)**