// seedVsattpChecklist.js — Nội dung mẫu checklist 'Trừ điểm theo hạng mục' VSATTP (An Toàn Thực Phẩm),
// trích XUẤT NGUYÊN VẸN từ file Excel người dùng gửi ('Báo cáo Checklist VSATTP Tháng 05.2026.xlsm',
// sheet 'Template ST'/'Template CH' — 2 sheet nội dung GIỐNG HỆT nhau, chỉ khác nhãn 'Siêu thị'/'Cửa
// hàng' nên chỉ cần 1 mẫu dùng chung) — dùng bởi seedDefaults.js để dựng sẵn 1 template DRAFT ngay lần
// khởi động đầu tiên sau khi triển khai tính năng, đúng yêu cầu người dùng ('dựng sẵn nội dung, chỉ cần
// Kích Hoạt là dùng ngay'). File TÁCH RIÊNG khỏi seedDefaults.js cho gọn (dữ liệu thuần, không logic).
'use strict';

const VSATTP_CHECKLIST_TEMPLATE = {
  templateCode: 'CL_VSATTP',
  templateName: 'Checklist Đánh Giá VSATTP (An Toàn Thực Phẩm)',
  categories: [
    {
      "name": "CHẤT LƯỢNG SẢN PHẨM",
      "maxDeduction": 30,
      "subItems": [
        {
          "name": "Chất lượng cảm quan",
          "maxDeduction": 30,
          "criteria": [
            {
              "description": "- Bao bì không nguyên vẹn, móp méo, xì chân không\n- Sản phẩm lẫn vật lạ (lông, tóc, tạp chất, bùn đất…), thối, hỏng, mốc, cảm quan không phù hợp…\n- Sản phẩm quá hạn thu rút khỏi quầy",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            }
          ]
        },
        {
          "name": "Hạn sử dụng",
          "maxDeduction": null,
          "criteria": [
            {
              "description": "- Sản phẩm hết hạn sử dụng \n- Sản phẩm bị kéo dài HSD",
              "perInstanceValue": 4,
              "ruleText": "Cho 1 mã SP không phù hợp"
            }
          ]
        }
      ]
    },
    {
      "name": "TRƯNG BÀY, BẢO QUẢN HÀNG HÓA",
      "maxDeduction": 35,
      "subItems": [
        {
          "name": "Nhãn hàng hóa, tem giá",
          "maxDeduction": 10,
          "criteria": [
            {
              "description": "Tem nhãn mờ nhòe, không có đầy đủ thông tin theo quy định, có đầy đủ nhưng không chính xác",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Sản phẩm trưng bày không có tem giá, tem giá không chính xác",
              "perInstanceValue": 2,
              "ruleText": "1-10 mã SP trừ 2 điểm\n>10 mã SP trừ 4 điểm"
            },
            {
              "description": "Sản phẩm có nhiều nhãn với thông tin mâu thuẫn nhau",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Không trừ bì khi cân sản phẩm, khối lượng trên tem nhãn và cân thực tế không khớp nhau",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            }
          ]
        },
        {
          "name": "Điều kiện trưng bày, bảo quản",
          "maxDeduction": 15,
          "criteria": [
            {
              "description": "Sản phẩm không được bảo quản theo đúng điều kiện trên nhãn hoặc điều kiện bảo quản với từng loại sản phẩm tươi sống, chế biến, đông lạnh….",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Sắp xếp hàng hóa không đảm bảo an toàn (hàng nặng, cồng kềnh để phía trên hàng hóa nhẹ, nhạy cảm..) dễ gây móp méo, hư hỏng sản phẩm",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp\n(kho-khu vực bán hàng)"
            },
            {
              "description": "Xuất kho/ trưng bày không theo nguyên tắc FEFO, FIFO",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Tủ đông/tủ mát: sắp xếp sản phẩm vượt quá giới hạn trưng bày cho phép; hoặc trưng bày quá nhiều che chắn họng gió của tủ.",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 tủ không phù hợp"
            },
            {
              "description": "Hàng hóa lưu kho không có đầy đủ thông tin nhận diện (NCC, Ngày nhập/Ngày rã đông/NSX - HSD, ….)",
              "perInstanceValue": 1,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Sản phẩm đóng gói lại không được đánh dấu để kiểm soát (đóng gọi lại tối đa 1 lần và HSD đảm bảo không vượt quá HSD của lần đóng gói đầu tiên)",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Rã đông: không đúng quy định. Tự ý cấp đông hoặc tái cấp đông sản phẩm đã rã đông",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 mã SP không phù hợp"
            }
          ]
        },
        {
          "name": "Nhiễm chéo",
          "maxDeduction": 10,
          "criteria": [
            {
              "description": "Bảo quản không tách biệt giữa: thực phẩm/phi thực phẩm; thực phẩm sống/dùng ngay; thực phẩm/vật phẩm trang trí/thực phẩm khác loại (như thịt, cá/ rau củ, gia vị); ...",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Thực phẩm, hoặc vật dụng đang chứa đựng thực phẩm tươi sống đặt trực tiếp dưới sàn, đặt nơi có nước ngưng tụ.",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Nguyên liệu sử dụng dang dở không được bao gói, cột chặt hoặc đậy kín",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Không tuân thủ quy định về thời gian lưu kho đối với hàng hóa không đảm bảo chất lượng, hết HSD, đăc biệt là hàng tươi sống",
              "perInstanceValue": 1,
              "ruleText": "Cho 1 mã SP không phù hợp"
            },
            {
              "description": "Hàng hủy, hàng chờ xử lý: Không được bao kín, tách biệt; không có biển nhận diện",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            }
          ]
        }
      ]
    },
    {
      "name": "VỆ SINH  CƠ SỞ VẬT CHẤT, CÔNG CỤ DỤNG CỤ",
      "maxDeduction": 20,
      "subItems": [
        {
          "name": "Cơ sở vật chất, trang thiết bị",
          "maxDeduction": 15,
          "criteria": [
            {
              "description": "Khu vực mặt tiền: Bẩn, có rác, nước đọng, để lộn xộn, nhiều vật dụng không cần thiết như khay rau, bìa carton…",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Khu vực thu ngân: Bẩn, không gọn gàng, bám bụi, để đồ cá nhân và các vật dụng không cần thiết, các tủ Locker bẩn, lộn xộn...",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Nhà vệ sinh: Có mùi hôi, bẩn, không đóng cửa; để thực phẩm hoặc vật dụng chứa đựng thực phẩm bên trong (khay xốp, túi thu ngân...",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Tường/trần/sàn: bị thấm/dột nước, rạn nứt, dính bám chất bẩn …",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Kho/Khu vực sơ chế/Khu vực bán hàng: Sắp xếp bừa bộn, lộn xộn, nhiều rác…",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Bồn rửa: Bẩn, rò rỉ, tắc, gỉ sét, đọng rác...",
              "perInstanceValue": 1,
              "ruleText": "Cho 1 vị trí không phù hợp"
            },
            {
              "description": "Quầy kệ, hàng hóa phục vụ cho việc sơ chế/bán hàng không sạch sẽ, bám bụi, đọng nước",
              "perInstanceValue": 2,
              "ruleText": "Cho 1 vị trí không phù hợp"
            }
          ]
        },
        {
          "name": "CCDC\n(Cân, thớt, dao….)",
          "maxDeduction": 5,
          "criteria": [
            {
              "description": "CCDC tiếp xúc trực tiếp với thực phẩm bị bẩn, mốc, gỉ sét, vết chặt sâu (thớt)",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Không ngăn nắp/ đặt không đúng nơi quy định",
              "perInstanceValue": 1,
              "ruleText": ""
            },
            {
              "description": "Thùng rác: Không có thùng rác hoặc thùng rác không có nắp đậy, không có túi đựng rác, bẩn, rác quá đầy, bốc mùi…",
              "perInstanceValue": 2,
              "ruleText": ""
            }
          ]
        }
      ]
    },
    {
      "name": "NHÂN VIÊN",
      "maxDeduction": 5,
      "subItems": [
        {
          "name": "Đồng phục",
          "maxDeduction": 5,
          "criteria": [
            {
              "description": "Không đúng đồng phục, trang phục của công ty",
              "perInstanceValue": 2,
              "ruleText": ""
            }
          ]
        },
        {
          "name": "Hành vi",
          "maxDeduction": null,
          "criteria": [
            {
              "description": "Nhân viên có tác phong không phù hợp trong thời gian làm việc (ngủ, nằm,...)",
              "perInstanceValue": 1,
              "ruleText": ""
            },
            {
              "description": "Ăn uống, hút thuốc, khạc nhổ trong cửa hàng/khu vực sơ chế",
              "perInstanceValue": 1,
              "ruleText": ""
            }
          ]
        },
        {
          "name": "Vệ sinh cá nhân",
          "maxDeduction": null,
          "criteria": [
            {
              "description": "Nhân viên không rửa tay trước khi tiếp xúc thực phẩm hay sau khi tay chạm vào các bề mặt không sạch",
              "perInstanceValue": 1,
              "ruleText": ""
            }
          ]
        }
      ]
    },
    {
      "name": "HẠNG MỤC KHÁC",
      "maxDeduction": 10,
      "subItems": [
        {
          "name": "Hồ sơ",
          "maxDeduction": 8,
          "criteria": [
            {
              "description": "Sổ theo dõi kiểm soát HSD của sản phẩm không đầy đủ/không có",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Sổ checklist nhiệt độ tủ theo dõi không đầy đủ/không có",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Không có sổ theo dõi hàng chờ đổi trả của NCC",
              "perInstanceValue": 1,
              "ruleText": ""
            },
            {
              "description": "Tem kiểm định cân: không có, hoặc hết hạn, hoặc bị rách",
              "perInstanceValue": 2,
              "ruleText": ""
            },
            {
              "description": "Không lưu trữ đầy đủ các giấy tờ hồ sơ về nguồn gốc xuất xứ của 1 số hàng hóa (Rau củ quả, thịt, cá, rượu, …) khi nhận hàng từ NCC (giấy kiểm dịch, giấy chứng nhận nguồn gốc, xuất xứ …)",
              "perInstanceValue": 1,
              "ruleText": ""
            }
          ]
        },
        {
          "name": "Kiểm soát động vật gây hại",
          "maxDeduction": 2,
          "criteria": [
            {
              "description": "Có dấu vết côn trùng/ động vật gây hại trong cửa hàng",
              "perInstanceValue": 2,
              "ruleText": ""
            }
          ]
        }
      ]
    }
  ],
};

module.exports = { VSATTP_CHECKLIST_TEMPLATE };
